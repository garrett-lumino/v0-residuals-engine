-- Migration: 20250201000300_create_deal_participants.sql
-- Purpose: Create normalized junction table for deal-partner relationships
-- Source: scripts/migrations/300_create_deal_participants.sql
-- Safe: Yes - Creates new table only

CREATE TABLE IF NOT EXISTS deal_participants (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relationships
  deal_id UUID NOT NULL,
  partner_id UUID NOT NULL,

  -- Split configuration
  split_pct NUMERIC(5,2) NOT NULL,
  role TEXT NOT NULL,

  -- Effective dating (for historical tracking)
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,

  -- Constraints
  CONSTRAINT dp_split_pct_range CHECK (split_pct >= 0 AND split_pct <= 100),
  CONSTRAINT dp_effective_dates_valid CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  )
);

-- Comments
COMMENT ON TABLE deal_participants IS 'Normalized junction table: deals <-> partners with split percentages';
COMMENT ON COLUMN deal_participants.split_pct IS 'Percentage of residual this partner receives (0-100)';
COMMENT ON COLUMN deal_participants.effective_from IS 'Date this split configuration became active';
COMMENT ON COLUMN deal_participants.effective_to IS 'Date this split ended (NULL = still active)';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dp_deal_id ON deal_participants(deal_id);
CREATE INDEX IF NOT EXISTS idx_dp_partner_id ON deal_participants(partner_id);
CREATE INDEX IF NOT EXISTS idx_dp_active ON deal_participants(deal_id) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_dp_deal_partner ON deal_participants(deal_id, partner_id);

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE deal_participants
    ADD CONSTRAINT fk_dp_deal_id 
    FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE;
  RAISE NOTICE 'Added FK: deal_participants -> deals';
EXCEPTION 
  WHEN duplicate_object THEN 
    RAISE NOTICE 'FK deal_participants -> deals already exists';
END $$;

DO $$ BEGIN
  ALTER TABLE deal_participants
    ADD CONSTRAINT fk_dp_partner_id 
    FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE RESTRICT;
  RAISE NOTICE 'Added FK: deal_participants -> partners';
EXCEPTION 
  WHEN duplicate_object THEN 
    RAISE NOTICE 'FK deal_participants -> partners already exists';
END $$;

