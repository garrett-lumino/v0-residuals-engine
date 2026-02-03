-- Migration: 20250201000302_add_split_validation_trigger.sql
-- Purpose: Add database-level enforcement of split percentage rules
-- Source: scripts/migrations/302_add_split_validation_trigger.sql
-- Safe: Yes - Trigger only affects future inserts/updates

-- Step 1: Create validation function
CREATE OR REPLACE FUNCTION validate_deal_splits()
RETURNS TRIGGER AS $$
DECLARE
  total_split NUMERIC;
  deal_mid TEXT;
BEGIN
  -- Calculate total split for this deal (only active participants)
  SELECT COALESCE(SUM(split_pct), 0) INTO total_split
  FROM deal_participants
  WHERE deal_id = NEW.deal_id 
    AND effective_to IS NULL
    AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  
  -- Add the new/updated split
  total_split := total_split + NEW.split_pct;
  
  -- Get MID for error message
  SELECT mid INTO deal_mid FROM deals WHERE id = NEW.deal_id;
  
  -- Validate: total must not exceed 100%
  IF total_split > 100 THEN
    RAISE EXCEPTION 'Split percentage validation failed for deal % (MID: %): total would be %, exceeds 100%%',
      NEW.deal_id, deal_mid, total_split;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION validate_deal_splits() IS 
  'Ensures total split percentage for active participants does not exceed 100%';

-- Step 2: Create trigger
DROP TRIGGER IF EXISTS trg_validate_deal_splits ON deal_participants;
CREATE TRIGGER trg_validate_deal_splits
  BEFORE INSERT OR UPDATE OF split_pct, deal_id, effective_to
  ON deal_participants
  FOR EACH ROW
  EXECUTE FUNCTION validate_deal_splits();

-- Step 3: Create function to check complete splits
CREATE OR REPLACE FUNCTION check_deal_splits_complete(p_deal_id UUID)
RETURNS TABLE (
  is_complete BOOLEAN,
  total_split NUMERIC,
  participant_count INTEGER,
  missing_pct NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    SUM(dp.split_pct) = 100 as is_complete,
    SUM(dp.split_pct) as total_split,
    COUNT(*)::integer as participant_count,
    100 - SUM(dp.split_pct) as missing_pct
  FROM deal_participants dp
  WHERE dp.deal_id = p_deal_id
    AND dp.effective_to IS NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_deal_splits_complete(UUID) IS 
  'Returns whether a deal has complete (100%) split allocation';

-- Step 4: View for incomplete deals
CREATE OR REPLACE VIEW v_deals_incomplete_splits AS
SELECT 
  d.id as deal_id,
  d.mid,
  COALESCE(dp_stats.total_split, 0) as total_split,
  100 - COALESCE(dp_stats.total_split, 0) as missing_pct,
  COALESCE(dp_stats.participant_count, 0) as participant_count
FROM deals d
LEFT JOIN LATERAL (
  SELECT 
    SUM(split_pct) as total_split,
    COUNT(*) as participant_count
  FROM deal_participants dp
  WHERE dp.deal_id = d.id AND dp.effective_to IS NULL
) dp_stats ON true
WHERE COALESCE(dp_stats.total_split, 0) != 100;

COMMENT ON VIEW v_deals_incomplete_splits IS 
  'Deals where normalized split percentages do not sum to exactly 100%';

