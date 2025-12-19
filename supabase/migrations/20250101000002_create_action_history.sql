-- Migration: 20250101000002_create_action_history.sql
-- Purpose: Action history table for audit and undo functionality
-- Source: scripts/009-create-action-history-table.sql

CREATE TABLE IF NOT EXISTS action_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Action classification
  action_type TEXT NOT NULL CHECK (action_type IN ('create', 'update', 'delete', 'bulk_update', 'import', 'sync', 'assign', 'unassign')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('deal', 'participant', 'payout', 'assignment', 'event', 'merchant', 'settings')),
  
  -- What was affected
  entity_id TEXT NOT NULL,
  entity_name TEXT,
  
  -- Data snapshots for undo
  previous_data JSONB,
  new_data JSONB,
  
  -- Human-readable description
  description TEXT NOT NULL,
  
  -- Who and when
  user_id UUID,
  user_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Undo tracking
  is_undone BOOLEAN DEFAULT FALSE,
  undone_at TIMESTAMPTZ,
  undone_by UUID,
  undo_action_id UUID REFERENCES action_history(id),
  
  -- Grouping for bulk operations
  batch_id UUID,
  
  -- Request correlation (added from 011 migration)
  request_id TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_action_history_entity ON action_history(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_action_history_created_at ON action_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_history_user ON action_history(user_id);
CREATE INDEX IF NOT EXISTS idx_action_history_batch ON action_history(batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_action_history_undone ON action_history(is_undone) WHERE is_undone = FALSE;
CREATE INDEX IF NOT EXISTS idx_action_history_request_id ON action_history(request_id) WHERE request_id IS NOT NULL;

-- Enable RLS
ALTER TABLE action_history ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all operations (can be restricted later)
DROP POLICY IF EXISTS "Allow all access to action_history" ON action_history;
CREATE POLICY "Allow all access to action_history" ON action_history
  FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE action_history IS 'Audit log of all user actions with undo capability';
COMMENT ON COLUMN action_history.previous_data IS 'JSON snapshot of entity state before the action (for undo)';
COMMENT ON COLUMN action_history.new_data IS 'JSON snapshot of entity state after the action';
COMMENT ON COLUMN action_history.batch_id IS 'Groups related actions together for bulk undo';
COMMENT ON COLUMN action_history.request_id IS 'Correlates with debug_logs.request_id to trace actions and errors from the same request';

