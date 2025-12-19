-- Migration: 20250201000201_migrate_partners_data.sql
-- Purpose: Populate partners table from existing deals and payouts data
-- Source: scripts/migrations/201_migrate_partners_data.sql
-- Safe: Yes - Uses INSERT ON CONFLICT to handle duplicates
-- NOTE: This migration requires existing data in deals/payouts tables

-- Step 1: Migrate unique partners from deals.participants_json
INSERT INTO partners (external_id, name, email, role, external_source)
SELECT DISTINCT
  participant->>'partner_airtable_id' as external_id,
  participant->>'partner_name' as name,
  NULLIF(TRIM(participant->>'partner_email'), '') as email,
  COALESCE(participant->>'partner_role', 'Partner') as role,
  'airtable' as external_source
FROM deals,
  jsonb_array_elements(participants_json) as participant
WHERE participant->>'partner_airtable_id' IS NOT NULL
  AND participant->>'partner_name' IS NOT NULL
ON CONFLICT (external_id) DO UPDATE SET
  email = COALESCE(EXCLUDED.email, partners.email),
  updated_at = now();

-- Step 2: Migrate any additional partners from payouts
INSERT INTO partners (external_id, name, role, external_source)
SELECT DISTINCT
  p.partner_airtable_id as external_id,
  p.partner_name as name,
  COALESCE(p.partner_role, 'Partner') as role,
  'airtable' as external_source
FROM payouts p
WHERE p.partner_airtable_id IS NOT NULL
  AND p.partner_name IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM partners WHERE external_id = p.partner_airtable_id
  )
ON CONFLICT (external_id) DO NOTHING;

