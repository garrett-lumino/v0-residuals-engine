-- Seed data for local development
-- Run with: supabase db reset (runs migrations then seed)

-- ============================================
-- Partner Sync (Airtable mirror - legacy)
-- ============================================
INSERT INTO partner_sync (airtable_record_id, name, email, role, default_split_pct) VALUES
  ('recTEST001', 'Test Agent Alpha', 'alpha@test.com', 'Agent', 50.00),
  ('recTEST002', 'Test Agent Beta', 'beta@test.com', 'Agent', 40.00),
  ('recTEST003', 'Test ISO Gamma', 'gamma@test.com', 'ISO', 30.00),
  ('recLUMINO', 'Lumino Technologies', 'admin@golumino.com', 'Company', 100.00),
  ('recFUND1', 'Lumino Income Fund LP', 'fund@golumino.com', 'Fund I', 25.00)
ON CONFLICT (airtable_record_id) DO NOTHING;

-- ============================================
-- Deals with participants
-- ============================================
INSERT INTO deals (id, mid, payout_type, participants_json, created_at) VALUES
  -- Deal 1: Standard 50/50 split
  ('11111111-1111-1111-1111-111111111111', '0012345678', 'residual', 
   '[{"partner_airtable_id": "recTEST001", "partner_name": "Test Agent Alpha", "partner_role": "Agent", "split_pct": 50},
     {"partner_airtable_id": "recLUMINO", "partner_name": "Lumino Technologies", "partner_role": "Company", "split_pct": 50}]',
   now() - interval '30 days'),
  
  -- Deal 2: 40/60 split
  ('22222222-2222-2222-2222-222222222222', '0087654321', 'residual',
   '[{"partner_airtable_id": "recTEST002", "partner_name": "Test Agent Beta", "partner_role": "Agent", "split_pct": 40},
     {"partner_airtable_id": "recLUMINO", "partner_name": "Lumino Technologies", "partner_role": "Company", "split_pct": 60}]',
   now() - interval '25 days'),
  
  -- Deal 3: Three-way split with ISO
  ('33333333-3333-3333-3333-333333333333', '0099887766', 'residual',
   '[{"partner_airtable_id": "recTEST003", "partner_name": "Test ISO Gamma", "partner_role": "ISO", "split_pct": 30},
     {"partner_airtable_id": "recTEST001", "partner_name": "Test Agent Alpha", "partner_role": "Agent", "split_pct": 20},
     {"partner_airtable_id": "recLUMINO", "partner_name": "Lumino Technologies", "partner_role": "Company", "split_pct": 50}]',
   now() - interval '20 days'),
  
  -- Deal 4: Bonus type deal
  ('44444444-4444-4444-4444-444444444444', '0012345678', 'bonus',
   '[{"partner_airtable_id": "recTEST001", "partner_name": "Test Agent Alpha", "partner_role": "Agent", "split_pct": 100}]',
   now() - interval '15 days')
ON CONFLICT (mid, payout_type) DO NOTHING;

-- ============================================
-- CSV Data (imported residual events)
-- ============================================
INSERT INTO csv_data (id, batch_id, merchant_name, mid, volume, fees, payout_month, assignment_status, payout_type, deal_id) VALUES
  -- January 2025 events
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 
   'Test Merchant One', '0012345678', 50000.00, 500.00, '2025-01', 'confirmed', 'residual',
   '11111111-1111-1111-1111-111111111111'),
  
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaab', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'Test Merchant Two', '0087654321', 75000.00, 750.00, '2025-01', 'confirmed', 'residual',
   '22222222-2222-2222-2222-222222222222'),
  
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaac', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'Test Merchant Three', '0099887766', 100000.00, 1000.00, '2025-01', 'confirmed', 'residual',
   '33333333-3333-3333-3333-333333333333'),
  
  -- February 2025 events (unassigned for testing)
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaad', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'Test Merchant One', '0012345678', 55000.00, 550.00, '2025-02', 'unassigned', 'residual', NULL),
  
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaae', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'Test Merchant Two', '0087654321', 80000.00, 800.00, '2025-02', 'unassigned', 'residual', NULL),
  
  -- Pending event
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaf', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'New Merchant', '0011223344', 25000.00, 250.00, '2025-02', 'pending', 'residual', NULL)
ON CONFLICT DO NOTHING;

-- ============================================
-- Payouts (calculated from csv_data + deals)
-- ============================================
INSERT INTO payouts (csv_data_id, mid, merchant_name, payout_month, payout_type, volume, fees, net_residual,
                     partner_airtable_id, partner_name, partner_role, partner_split_pct, partner_payout_amount,
                     assignment_status, paid_status) VALUES
  -- January 2025 payouts for Deal 1 (50/50)
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '0012345678', 'Test Merchant One', '2025-01', 'residual',
   50000.00, 500.00, 500.00, 'recTEST001', 'Test Agent Alpha', 'Agent', 50.00, 250.00, 'confirmed', 'unpaid'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '0012345678', 'Test Merchant One', '2025-01', 'residual',
   50000.00, 500.00, 500.00, 'recLUMINO', 'Lumino Technologies', 'Company', 50.00, 250.00, 'confirmed', 'unpaid'),

  -- January 2025 payouts for Deal 2 (40/60)
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaab', '0087654321', 'Test Merchant Two', '2025-01', 'residual',
   75000.00, 750.00, 750.00, 'recTEST002', 'Test Agent Beta', 'Agent', 40.00, 300.00, 'confirmed', 'unpaid'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaab', '0087654321', 'Test Merchant Two', '2025-01', 'residual',
   75000.00, 750.00, 750.00, 'recLUMINO', 'Lumino Technologies', 'Company', 60.00, 450.00, 'confirmed', 'unpaid'),

  -- January 2025 payouts for Deal 3 (three-way)
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaac', '0099887766', 'Test Merchant Three', '2025-01', 'residual',
   100000.00, 1000.00, 1000.00, 'recTEST003', 'Test ISO Gamma', 'ISO', 30.00, 300.00, 'confirmed', 'unpaid'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaac', '0099887766', 'Test Merchant Three', '2025-01', 'residual',
   100000.00, 1000.00, 1000.00, 'recTEST001', 'Test Agent Alpha', 'Agent', 20.00, 200.00, 'confirmed', 'unpaid'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaac', '0099887766', 'Test Merchant Three', '2025-01', 'residual',
   100000.00, 1000.00, 1000.00, 'recLUMINO', 'Lumino Technologies', 'Company', 50.00, 500.00, 'confirmed', 'unpaid')
ON CONFLICT DO NOTHING;

-- ============================================
-- Populate Normalized Tables
-- ============================================
-- These run AFTER seed data is inserted to populate the new schema tables

-- Step 1: Populate partners from deals.participants_json
INSERT INTO partners (external_id, name, role, external_source)
SELECT DISTINCT
  participant->>'partner_airtable_id',
  participant->>'partner_name',
  COALESCE(participant->>'partner_role', 'Partner'),
  'airtable'
FROM deals, jsonb_array_elements(participants_json) as participant
WHERE participant->>'partner_airtable_id' IS NOT NULL
ON CONFLICT (external_id) DO NOTHING;

-- Step 2: Populate deal_participants junction table
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

-- Step 3: Backfill payouts.partner_id from partners table
UPDATE payouts p
SET partner_id = pr.id
FROM partners pr
WHERE p.partner_airtable_id = pr.external_id
  AND p.partner_id IS NULL;

-- ============================================
-- Summary
-- ============================================
-- After seeding, you should have:
-- - 5 partners in partner_sync (legacy Airtable mirror)
-- - 4 partners in partners (normalized)
-- - 4 deals (3 residual, 1 bonus)
-- - 8 deal_participants (normalized splits)
-- - 6 csv_data events (3 confirmed, 2 unassigned, 1 pending)
-- - 7 payouts for January 2025 (all with partner_id linked)
