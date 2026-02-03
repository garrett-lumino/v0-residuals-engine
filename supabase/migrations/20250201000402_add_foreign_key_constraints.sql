-- Migration: 20250201000402_add_foreign_key_constraints.sql
-- Purpose: Add referential integrity constraints
-- Source: scripts/migrations/402_add_foreign_key_constraints.sql
-- Safe: VERIFY DATA FIRST - Constraints will fail if orphaned records exist

-- Add FK on payouts.partner_id
DO $$ BEGIN
  -- Only add if no violations
  IF NOT EXISTS (
    SELECT 1 FROM payouts p
    WHERE p.partner_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM partners WHERE id = p.partner_id)
    LIMIT 1
  ) THEN
    ALTER TABLE payouts
      ADD CONSTRAINT fk_payouts_partner_id
      FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE RESTRICT;
    RAISE NOTICE 'Added FK: payouts.partner_id -> partners.id';
  ELSE
    RAISE WARNING 'Skipping FK on payouts.partner_id - orphaned records exist';
  END IF;
EXCEPTION 
  WHEN duplicate_object THEN 
    RAISE NOTICE 'FK payouts.partner_id already exists';
END $$;

