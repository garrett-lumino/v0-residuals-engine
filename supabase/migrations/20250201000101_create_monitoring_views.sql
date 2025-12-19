-- Migration: 20250201000101_create_monitoring_views.sql
-- Purpose: Create views to monitor data integrity issues
-- Source: scripts/migrations/101_create_monitoring_views.sql
-- Safe: Yes - Views are non-destructive

-- View: Deals with invalid split percentages (not summing to 100%)
CREATE OR REPLACE VIEW v_deals_invalid_splits AS
SELECT 
  id,
  mid,
  jsonb_array_length(participants_json) as participant_count,
  (
    SELECT COALESCE(SUM((p->>'split_pct')::numeric), 0) 
    FROM jsonb_array_elements(participants_json) p
  ) as total_split_pct,
  100 - (
    SELECT COALESCE(SUM((p->>'split_pct')::numeric), 0) 
    FROM jsonb_array_elements(participants_json) p
  ) as missing_pct,
  participants_json
FROM deals
WHERE (
  SELECT COALESCE(SUM((p->>'split_pct')::numeric), 0) 
  FROM jsonb_array_elements(participants_json) p
) != 100;

COMMENT ON VIEW v_deals_invalid_splits IS 'Identifies deals where participant split percentages do not sum to 100%';

-- View: Orphaned payouts (csv_data_id references non-existent records)
CREATE OR REPLACE VIEW v_orphaned_payouts AS
SELECT 
  p.id,
  p.csv_data_id,
  p.mid,
  p.partner_name,
  p.partner_payout_amount,
  p.payout_month
FROM payouts p
WHERE p.csv_data_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM csv_data c WHERE c.id = p.csv_data_id
  );

COMMENT ON VIEW v_orphaned_payouts IS 'Payouts referencing csv_data records that no longer exist';

-- View: Payouts with unknown partners (not in deals.participants_json)
CREATE OR REPLACE VIEW v_unknown_partners AS
SELECT DISTINCT
  p.partner_airtable_id,
  p.partner_name,
  p.partner_role,
  COUNT(*) as payout_count,
  SUM(p.partner_payout_amount) as total_amount
FROM payouts p
WHERE NOT EXISTS (
  SELECT 1 FROM deals d, 
    jsonb_array_elements(d.participants_json) as participant
  WHERE participant->>'partner_airtable_id' = p.partner_airtable_id
)
GROUP BY p.partner_airtable_id, p.partner_name, p.partner_role
ORDER BY payout_count DESC;

COMMENT ON VIEW v_unknown_partners IS 'Partners in payouts that do not exist in any deal participants';

-- View: Data integrity summary
CREATE OR REPLACE VIEW v_data_integrity_summary AS
SELECT 
  'Invalid Splits' as issue_type,
  (SELECT COUNT(*) FROM v_deals_invalid_splits) as count,
  'Deals with split % != 100' as description
UNION ALL
SELECT 
  'Orphaned Payouts',
  (SELECT COUNT(*) FROM v_orphaned_payouts),
  'Payouts referencing missing csv_data'
UNION ALL
SELECT 
  'Unknown Partners',
  (SELECT COUNT(*) FROM v_unknown_partners),
  'Partner IDs in payouts not found in deals';

COMMENT ON VIEW v_data_integrity_summary IS 'Summary of all data integrity issues';

