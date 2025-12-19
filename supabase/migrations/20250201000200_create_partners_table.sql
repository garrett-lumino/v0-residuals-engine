-- Migration: 20250201000200_create_partners_table.sql
-- Purpose: Create normalized partners table (decoupled from Airtable)
-- Source: scripts/migrations/200_create_partners_table.sql
-- Safe: Yes - Creates new table only

CREATE TABLE IF NOT EXISTS partners (
  -- Primary key (internal)
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- External system reference (Airtable)
  external_id TEXT UNIQUE,
  external_source TEXT NOT NULL DEFAULT 'airtable',

  -- Core partner data
  name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL,

  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,

  -- Sync tracking
  synced_at TIMESTAMPTZ,
  sync_status TEXT DEFAULT 'pending',
  sync_error TEXT,

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT partners_name_not_empty CHECK (length(trim(name)) > 0),
  CONSTRAINT partners_external_source_valid CHECK (
    external_source IN ('airtable', 'manual', 'system')
  ),
  CONSTRAINT partners_sync_status_valid CHECK (
    sync_status IN ('pending', 'synced', 'failed')
  )
);

-- Comments
COMMENT ON TABLE partners IS 'Normalized partner/agent data, decoupled from Airtable';
COMMENT ON COLUMN partners.external_id IS 'Airtable record ID (recXXX) or special ID (lumino-company)';
COMMENT ON COLUMN partners.external_source IS 'Source system: airtable, manual entry, or system-generated';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_partners_external_id ON partners(external_id);
CREATE INDEX IF NOT EXISTS idx_partners_name ON partners(name);
CREATE INDEX IF NOT EXISTS idx_partners_role ON partners(role);
CREATE INDEX IF NOT EXISTS idx_partners_active ON partners(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_partners_sync_status ON partners(sync_status) WHERE sync_status != 'synced';

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_partners_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_partners_updated_at ON partners;
CREATE TRIGGER trg_partners_updated_at
  BEFORE UPDATE ON partners
  FOR EACH ROW
  EXECUTE FUNCTION update_partners_updated_at();

