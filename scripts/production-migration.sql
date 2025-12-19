-- =============================================================================
-- PRODUCTION MIGRATION SCRIPT
-- =============================================================================
-- Run this in Supabase Dashboard > SQL Editor
-- Date: 2024-12-19
-- Purpose: Add normalized partners schema without affecting existing data
-- =============================================================================

-- PART 1: ENUM TYPES
DO $$ BEGIN CREATE TYPE assignment_status_enum AS ENUM ('unassigned', 'pending', 'confirmed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE payment_status_enum AS ENUM ('unpaid', 'pending', 'paid'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE payout_type_enum AS ENUM ('residual', 'upfront', 'trueup', 'bonus', 'clawback', 'adjustment'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE partner_role_enum AS ENUM ('ISO', 'Agent', 'Sub-Agent', 'Investor', 'Partner', 'Company', 'Fund I'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE sync_status_enum AS ENUM ('pending', 'synced', 'failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PART 2: MONITORING VIEWS
CREATE OR REPLACE VIEW v_deals_invalid_splits AS
SELECT id, mid, jsonb_array_length(participants_json) as participant_count,
  (SELECT COALESCE(SUM((p->>'split_pct')::numeric), 0) FROM jsonb_array_elements(participants_json) p) as total_split_pct,
  100 - (SELECT COALESCE(SUM((p->>'split_pct')::numeric), 0) FROM jsonb_array_elements(participants_json) p) as missing_pct
FROM deals WHERE (SELECT COALESCE(SUM((p->>'split_pct')::numeric), 0) FROM jsonb_array_elements(participants_json) p) != 100;

CREATE OR REPLACE VIEW v_orphaned_payouts AS
SELECT p.id, p.csv_data_id, p.mid, p.partner_name, p.partner_payout_amount, p.payout_month
FROM payouts p WHERE p.csv_data_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM csv_data c WHERE c.id = p.csv_data_id);

CREATE OR REPLACE VIEW v_data_integrity_summary AS
SELECT 'Invalid Splits' as issue_type, (SELECT COUNT(*) FROM v_deals_invalid_splits) as count
UNION ALL SELECT 'Orphaned Payouts', (SELECT COUNT(*) FROM v_orphaned_payouts);

-- PART 3: PARTNERS TABLE
CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT UNIQUE,
  external_source TEXT NOT NULL DEFAULT 'airtable',
  name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  synced_at TIMESTAMPTZ,
  sync_status TEXT DEFAULT 'pending',
  sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partners_name_not_empty CHECK (length(trim(name)) > 0),
  CONSTRAINT partners_external_source_valid CHECK (external_source IN ('airtable', 'manual', 'system')),
  CONSTRAINT partners_sync_status_valid CHECK (sync_status IN ('pending', 'synced', 'failed'))
);
CREATE INDEX IF NOT EXISTS idx_partners_external_id ON partners(external_id);
CREATE INDEX IF NOT EXISTS idx_partners_name ON partners(name);
CREATE INDEX IF NOT EXISTS idx_partners_role ON partners(role);

CREATE OR REPLACE FUNCTION update_partners_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_partners_updated_at ON partners;
CREATE TRIGGER trg_partners_updated_at BEFORE UPDATE ON partners FOR EACH ROW EXECUTE FUNCTION update_partners_updated_at();

-- PART 4: MIGRATE PARTNER DATA (deduplicated)
INSERT INTO partners (external_id, name, email, role, external_source)
SELECT external_id, name, email, role, 'airtable'
FROM (
  SELECT DISTINCT ON (participant->>'partner_airtable_id')
    participant->>'partner_airtable_id' as external_id,
    participant->>'partner_name' as name,
    NULLIF(TRIM(participant->>'partner_email'), '') as email,
    COALESCE(participant->>'partner_role', 'Partner') as role
  FROM deals, jsonb_array_elements(participants_json) as participant
  WHERE participant->>'partner_airtable_id' IS NOT NULL
    AND participant->>'partner_name' IS NOT NULL
  ORDER BY participant->>'partner_airtable_id', participant->>'partner_email' NULLS LAST
) deduped
ON CONFLICT (external_id) DO UPDATE SET
  email = COALESCE(EXCLUDED.email, partners.email),
  updated_at = now();

INSERT INTO partners (external_id, name, role, external_source)
SELECT DISTINCT ON (partner_airtable_id) partner_airtable_id, partner_name, COALESCE(partner_role, 'Partner'), 'airtable'
FROM payouts WHERE partner_airtable_id IS NOT NULL AND partner_name IS NOT NULL
ORDER BY partner_airtable_id
ON CONFLICT (external_id) DO NOTHING;

-- PART 5: DEAL_PARTICIPANTS TABLE
CREATE TABLE IF NOT EXISTS deal_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL,
  partner_id UUID NOT NULL,
  split_pct NUMERIC(5,2) NOT NULL,
  role TEXT NOT NULL,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  CONSTRAINT dp_split_pct_range CHECK (split_pct >= 0 AND split_pct <= 100),
  CONSTRAINT dp_effective_dates_valid CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS idx_dp_deal_id ON deal_participants(deal_id);
CREATE INDEX IF NOT EXISTS idx_dp_partner_id ON deal_participants(partner_id);
CREATE INDEX IF NOT EXISTS idx_dp_deal_partner ON deal_participants(deal_id, partner_id);

DO $$ BEGIN ALTER TABLE deal_participants ADD CONSTRAINT fk_dp_deal_id FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE deal_participants ADD CONSTRAINT fk_dp_partner_id FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PART 6: MIGRATE PARTICIPANTS DATA
INSERT INTO deal_participants (deal_id, partner_id, split_pct, role, effective_from)
SELECT d.id, p.id, (participant->>'split_pct')::numeric, COALESCE(participant->>'partner_role', 'Partner'), COALESCE(d.effective_date, d.created_at::date)
FROM deals d CROSS JOIN LATERAL jsonb_array_elements(d.participants_json) as participant
JOIN partners p ON p.external_id = participant->>'partner_airtable_id'
WHERE participant->>'partner_airtable_id' IS NOT NULL
ON CONFLICT DO NOTHING;

-- PART 7: SPLIT VALIDATION TRIGGER
CREATE OR REPLACE FUNCTION validate_deal_splits() RETURNS TRIGGER AS $$
DECLARE total_split NUMERIC; deal_mid TEXT;
BEGIN
  SELECT COALESCE(SUM(split_pct), 0) INTO total_split FROM deal_participants
  WHERE deal_id = NEW.deal_id AND effective_to IS NULL AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  total_split := total_split + NEW.split_pct;
  SELECT mid INTO deal_mid FROM deals WHERE id = NEW.deal_id;
  IF total_split > 100 THEN RAISE EXCEPTION 'Split validation failed: total %, exceeds 100', total_split; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_deal_splits ON deal_participants;
CREATE TRIGGER trg_validate_deal_splits BEFORE INSERT OR UPDATE OF split_pct, deal_id, effective_to ON deal_participants FOR EACH ROW EXECUTE FUNCTION validate_deal_splits();

CREATE OR REPLACE VIEW v_deals_incomplete_splits AS
SELECT d.id as deal_id, d.mid, COALESCE(SUM(dp.split_pct), 0) as total_split, 100 - COALESCE(SUM(dp.split_pct), 0) as missing_pct
FROM deals d LEFT JOIN deal_participants dp ON dp.deal_id = d.id AND dp.effective_to IS NULL
GROUP BY d.id, d.mid HAVING COALESCE(SUM(dp.split_pct), 0) != 100;

-- PART 8: ADD PAYOUTS.PARTNER_ID
DO $$ BEGIN ALTER TABLE payouts ADD COLUMN partner_id UUID; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_payouts_partner_id ON payouts(partner_id);

UPDATE payouts p SET partner_id = pr.id FROM partners pr WHERE p.partner_airtable_id = pr.external_id AND p.partner_id IS NULL;

-- PART 9: FOREIGN KEY ON PAYOUTS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM payouts p WHERE p.partner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM partners WHERE id = p.partner_id) LIMIT 1) THEN
    ALTER TABLE payouts ADD CONSTRAINT fk_payouts_partner_id FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE RESTRICT;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PART 10: ADD DEALS.MERCHANT_NAME (may already exist)
ALTER TABLE deals ADD COLUMN IF NOT EXISTS merchant_name TEXT;

-- =============================================================================
-- VERIFICATION QUERIES (run after migration):
-- =============================================================================
-- SELECT * FROM v_data_integrity_summary;
-- SELECT COUNT(*) as partner_count FROM partners;
-- SELECT COUNT(*) as participant_count FROM deal_participants;
-- SELECT COUNT(*) as payouts_with_partner_id FROM payouts WHERE partner_id IS NOT NULL;
