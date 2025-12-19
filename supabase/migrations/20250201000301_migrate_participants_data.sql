-- Migration: 20250201000301_migrate_participants_data.sql
-- Purpose: Migrate data from deals.participants_json to deal_participants table
-- Source: scripts/migrations/301_migrate_participants_data.sql
-- Safe: Yes - Uses INSERT only, preserves source data
-- NOTE: This migration requires data in deals and partners tables

-- Migrate participants to junction table
INSERT INTO deal_participants (deal_id, partner_id, split_pct, role, effective_from)
SELECT
  d.id as deal_id,
  p.id as partner_id,
  (participant->>'split_pct')::numeric as split_pct,
  COALESCE(participant->>'partner_role', 'Partner') as role,
  COALESCE(d.effective_date, d.created_at::date) as effective_from
FROM deals d
CROSS JOIN LATERAL jsonb_array_elements(d.participants_json) as participant
JOIN partners p ON p.external_id = participant->>'partner_airtable_id'
WHERE participant->>'partner_airtable_id' IS NOT NULL
ON CONFLICT DO NOTHING;

