-- Migration: 20250101000001_create_base_schema.sql
-- Purpose: Create initial production schema (tables, indexes, constraints)
-- Source: scripts/001_create_schema.sql

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Merchants Table
CREATE TABLE IF NOT EXISTS public.merchants (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  merchant_id TEXT NULL,
  dba_name TEXT NULL,
  legal_name TEXT NULL,
  mid TEXT NULL,
  primary_email TEXT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  account_assignment_status TEXT NOT NULL DEFAULT 'available',
  assigned_agent_id UUID NULL,
  tier INTEGER NULL,
  boarding_platform TEXT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  available_to_purchase BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT merchants_pkey PRIMARY KEY (id),
  CONSTRAINT merchants_mid_key UNIQUE (mid)
);

-- 2. Partner Sync Table (Airtable Source)
CREATE TABLE IF NOT EXISTS public.partner_sync (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  airtable_record_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NULL,
  role TEXT NULL,
  default_payout_type TEXT NULL DEFAULT 'residual',
  default_split_pct NUMERIC(5,2) NULL,
  last_synced_at TIMESTAMP WITH TIME ZONE NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT NULL,
  CONSTRAINT partner_sync_pkey PRIMARY KEY (id),
  CONSTRAINT partner_sync_airtable_id_key UNIQUE (airtable_record_id)
);

-- 3. Deals Table (Logic for Splits)
CREATE TABLE IF NOT EXISTS public.deals (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  deal_id TEXT NULL,
  merchant_id UUID NULL,
  mid TEXT NULL,
  effective_date DATE NULL,
  plan TEXT NULL,
  payout_type TEXT NULL DEFAULT 'residual',
  participants_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  assigned_agent_name TEXT NULL,
  assigned_at TIMESTAMP WITH TIME ZONE NULL,
  partner_id TEXT NULL,
  created_by UUID NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  available_to_purchase BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT deals_pkey PRIMARY KEY (id),
  CONSTRAINT deals_mid_payout_type_idx UNIQUE (mid, payout_type)
);

-- 4. CSV Data Table (Imported Events)
CREATE TABLE IF NOT EXISTS public.csv_data (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  batch_id UUID NULL,
  merchant_name TEXT NULL,
  mid TEXT NULL,
  volume NUMERIC(12,2) NULL DEFAULT 0,
  fees NUMERIC(12,2) NULL DEFAULT 0,
  date DATE NULL,
  payout_month TEXT NULL,
  assigned_agent_id TEXT NULL,
  assigned_agent_name TEXT NULL,
  deal_id UUID NULL,
  status TEXT NULL,
  assignment_status TEXT NOT NULL DEFAULT 'unassigned',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  row_hash TEXT NULL,
  adjustments NUMERIC(12,2) NULL DEFAULT 0,
  chargebacks NUMERIC(12,2) NULL DEFAULT 0,
  raw_data JSONB NULL,
  is_held BOOLEAN NOT NULL DEFAULT false,
  hold_reason TEXT NULL,
  airtable_synced BOOLEAN NOT NULL DEFAULT false,
  payout_type TEXT NOT NULL DEFAULT 'residual',
  adjustment_type TEXT NULL,
  adjusts_payout_id UUID NULL,
  paid_at TIMESTAMP WITH TIME ZONE NULL,
  paid_by UUID NULL,
  paid_status TEXT NOT NULL DEFAULT 'unpaid',
  CONSTRAINT csv_data_pkey PRIMARY KEY (id),
  CONSTRAINT csv_data_row_hash_key UNIQUE (row_hash)
);

-- 5. Payouts Table (Calculated Results)
CREATE TABLE IF NOT EXISTS public.payouts (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  csv_data_id UUID NULL,
  deal_id TEXT NULL,
  merchant_id UUID NULL,
  payout_month TEXT NULL,
  payout_date DATE NULL,
  mid TEXT NULL,
  merchant_name TEXT NULL,
  payout_type TEXT NULL,
  volume NUMERIC(12, 2) NULL DEFAULT 0,
  fees NUMERIC(12, 2) NULL DEFAULT 0,
  adjustments NUMERIC(12, 2) NULL DEFAULT 0,
  chargebacks NUMERIC(12, 2) NULL DEFAULT 0,
  net_residual NUMERIC(12, 2) NULL DEFAULT 0,
  partner_airtable_id TEXT NULL,
  partner_name TEXT NULL,
  partner_role TEXT NULL,
  partner_split_pct NUMERIC(5, 2) NULL,
  partner_payout_amount NUMERIC(12, 2) NULL,
  deal_plan TEXT NULL,
  assignment_status TEXT NULL DEFAULT 'confirmed'::text,
  paid_status TEXT NULL DEFAULT 'unpaid'::text,
  paid_at TIMESTAMP WITH TIME ZONE NULL,
  batch_id UUID NULL,
  created_at TIMESTAMP WITH TIME ZONE NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NULL DEFAULT now(),
  CONSTRAINT payouts_pkey PRIMARY KEY (id),
  CONSTRAINT payouts_unique_partner_payout UNIQUE (csv_data_id, partner_airtable_id),
  CONSTRAINT payouts_csv_data_id_fkey FOREIGN KEY (csv_data_id) REFERENCES csv_data (id) ON DELETE CASCADE
);

-- Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_csv_data_mid ON public.csv_data(mid);
CREATE INDEX IF NOT EXISTS idx_csv_data_status ON public.csv_data(assignment_status);
CREATE INDEX IF NOT EXISTS idx_csv_data_month ON public.csv_data(payout_month);

CREATE INDEX IF NOT EXISTS idx_deals_mid ON public.deals(mid);

CREATE INDEX IF NOT EXISTS idx_payouts_csv_data_id ON public.payouts(csv_data_id);
CREATE INDEX IF NOT EXISTS idx_payouts_partner_airtable_id ON public.payouts(partner_airtable_id);
CREATE INDEX IF NOT EXISTS idx_payouts_payout_month ON public.payouts(payout_month);

