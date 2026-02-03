-- Migration: 20250201000400_add_payouts_partner_id.sql
-- Purpose: Add partner_id column to payouts for normalized partner reference
-- Source: scripts/migrations/400_add_payouts_partner_id.sql
-- Safe: Yes - Adds nullable column only

-- Step 1: Add partner_id column (nullable initially)
DO $$ BEGIN
  ALTER TABLE payouts ADD COLUMN partner_id UUID;
  RAISE NOTICE 'Added partner_id column to payouts';
EXCEPTION 
  WHEN duplicate_column THEN 
    RAISE NOTICE 'partner_id column already exists on payouts';
END $$;

COMMENT ON COLUMN payouts.partner_id IS 
  'Foreign key to partners table (normalized). Replaces partner_airtable_id.';

-- Step 2: Create index for lookups
CREATE INDEX IF NOT EXISTS idx_payouts_partner_id ON payouts(partner_id);

-- Step 3: Backfill partner_id from partner_airtable_id
UPDATE payouts p
SET partner_id = pr.id
FROM partners pr
WHERE p.partner_airtable_id = pr.external_id
  AND p.partner_id IS NULL;

