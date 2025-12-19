-- Migration: 20250201000100_create_enum_types.sql
-- Purpose: Create PostgreSQL ENUM types for status fields
-- Source: scripts/migrations/100_create_enum_types.sql
-- Safe: Yes - Uses DO blocks with exception handling for idempotency

-- Assignment Status (workflow state for residual events)
DO $$ BEGIN
  CREATE TYPE assignment_status_enum AS ENUM ('unassigned', 'pending', 'confirmed');
  RAISE NOTICE 'Created assignment_status_enum';
EXCEPTION 
  WHEN duplicate_object THEN 
    RAISE NOTICE 'assignment_status_enum already exists, skipping';
END $$;

-- Payment Status (workflow state for payouts)
DO $$ BEGIN
  CREATE TYPE payment_status_enum AS ENUM ('unpaid', 'pending', 'paid');
  RAISE NOTICE 'Created payment_status_enum';
EXCEPTION 
  WHEN duplicate_object THEN 
    RAISE NOTICE 'payment_status_enum already exists, skipping';
END $$;

-- Payout Type (classification of residual/payment)
DO $$ BEGIN
  CREATE TYPE payout_type_enum AS ENUM (
    'residual', 
    'upfront', 
    'trueup', 
    'bonus', 
    'clawback', 
    'adjustment'
  );
  RAISE NOTICE 'Created payout_type_enum';
EXCEPTION 
  WHEN duplicate_object THEN 
    RAISE NOTICE 'payout_type_enum already exists, skipping';
END $$;

-- Partner Role (type of partner in a deal)
DO $$ BEGIN
  CREATE TYPE partner_role_enum AS ENUM (
    'ISO',
    'Agent', 
    'Sub-Agent',
    'Investor',
    'Partner',
    'Company',
    'Fund I'
  );
  RAISE NOTICE 'Created partner_role_enum';
EXCEPTION 
  WHEN duplicate_object THEN 
    RAISE NOTICE 'partner_role_enum already exists, skipping';
END $$;

-- Sync Status (external system synchronization state)
DO $$ BEGIN
  CREATE TYPE sync_status_enum AS ENUM ('pending', 'synced', 'failed');
  RAISE NOTICE 'Created sync_status_enum';
EXCEPTION 
  WHEN duplicate_object THEN 
    RAISE NOTICE 'sync_status_enum already exists, skipping';
END $$;

