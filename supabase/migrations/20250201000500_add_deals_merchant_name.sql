-- Add merchant_name column to deals table
-- This column stores the merchant/DBA name for display purposes
-- It's denormalized from csv_data for convenience

ALTER TABLE deals 
ADD COLUMN IF NOT EXISTS merchant_name TEXT;

-- Add comment for documentation
COMMENT ON COLUMN deals.merchant_name IS 'Merchant/DBA name - denormalized for display convenience';

