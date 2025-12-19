// =============================================================================
// Status Types (must match database ENUMs after migration)
// =============================================================================
export type AssignmentStatus = "unassigned" | "pending" | "confirmed"
export type PaidStatus = "unpaid" | "pending" | "paid"
export type PayoutType = "residual" | "upfront" | "trueup" | "bonus" | "clawback" | "adjustment"
export type AdjustmentType = "clawback" | "additional"
export type PartnerRole = "ISO" | "Agent" | "Sub-Agent" | "Investor" | "Partner" | "Company" | "Fund I"
export type SyncStatus = "pending" | "synced" | "failed"
export type ExternalSource = "airtable" | "manual" | "system"
export type MerchantStatus = "active" | "inactive" | "suspended"
export type AccountAssignmentStatus = "available" | "assigned" | "confirmed"
export type BoardingPlatform = "Nuvei" | "Fiserv" | "Shift4" | "Cardpointe"

// Participant structure in deals.participants_json
// IMPORTANT: These field names MUST match the database format
export interface DealParticipant {
  partner_airtable_id: string | null  // Airtable record ID - THE KEY IDENTIFIER
  partner_name: string | null
  partner_email?: string | null
  partner_role: PartnerRole | string | null
  split_pct: number // 0-100
  amount?: number // Calculated payout amount, optional
}

// csv_data table
export interface CsvData {
  id: string
  batch_id: string | null
  merchant_name: string | null
  mid: string | null
  volume: number | null
  fees: number | null
  date: string | null // ISO date string
  payout_month: string | null
  assigned_agent_id: string | null
  assigned_agent_name: string | null
  deal_id: string | null
  status: string | null // DEPRECATED
  assignment_status: AssignmentStatus
  created_at: string
  updated_at: string
  row_hash: string | null
  adjustments: number
  chargebacks: number
  raw_data: Record<string, any>
  is_held: boolean
  hold_reason: string | null
  airtable_synced: boolean
  payout_type: PayoutType
  adjustment_type: AdjustmentType | null
  adjusts_payout_id: string | null
  paid_at: string | null
  paid_status: PaidStatus
}

// deals table
export interface Deal {
  id: string
  deal_id: string | null
  mid: string | null
  effective_date: string | null
  payout_type: PayoutType | null
  participants_json: DealParticipant[]
  assigned_agent_name: string | null
  assigned_at: string | null
  partner_id: string | null // DEPRECATED
  created_by: string | null
  created_at: string
  updated_at: string
  available_to_purchase: boolean
  is_legacy_import: boolean
}

// payouts table
export interface Payout {
  id: string
  csv_data_id: string | null
  deal_id: string | null
  payout_month: string | null
  payout_date: string | null
  mid: string | null
  merchant_name: string | null
  payout_type: PayoutType | null
  volume: number
  fees: number
  adjustments: number
  chargebacks: number
  net_residual: number
  partner_airtable_id: string | null
  partner_name: string | null
  partner_role: string | null
  partner_split_pct: number | null
  partner_payout_amount: number | null
  assignment_status: AssignmentStatus
  paid_status: PaidStatus
  paid_at: string | null
  batch_id: string | null
  created_at: string
  updated_at: string
  is_legacy_import: boolean
}

// partner_sync table (Airtable source - LEGACY)
export interface PartnerSync {
  id: string
  airtable_record_id: string
  name: string
  email: string | null
  role: string | null
  default_split_pct: number | null
  last_synced_at: string | null
  created_at: string
  updated_at: string
  is_active: boolean
  notes: string | null
}

// =============================================================================
// NEW: Normalized Partners Table
// =============================================================================

/**
 * Partner record from the normalized partners table
 * This is the new source of truth for partner data
 */
export interface Partner {
  id: string // UUID primary key
  external_id: string | null // Airtable record ID (e.g., "recABC123")
  external_source: ExternalSource // Where the partner originated
  name: string
  email: string | null
  role: PartnerRole | string
  is_active: boolean
  synced_at: string | null
  sync_status: SyncStatus
  created_at: string
  updated_at: string
}

/**
 * Deal Participants junction table record
 * Links deals to partners with split percentages
 */
export interface DealParticipantRecord {
  id: string // UUID primary key
  deal_id: string // FK to deals.id
  partner_id: string // FK to partners.id
  split_pct: number // 0-100
  role: PartnerRole | string
  effective_from: string // ISO date - when this split became active
  effective_to: string | null // NULL = currently active
  created_at: string
  created_by: string | null
}

/**
 * Extended Payout with partner_id support
 * Used during migration when both old and new IDs are present
 */
export interface PayoutWithPartnerId extends Payout {
  partner_id: string | null // NEW: FK to partners.id
}

// Useful computed types
export interface EventWithDeal extends CsvData {
  deal: Deal | null
}

export interface PayoutSummary {
  partner_airtable_id: string
  partner_name: string
  partner_role?: string // "Various" if multiple roles
  merchant_count: number // COUNT(DISTINCT mid)
  total_payout: number
  paid_count: number
  unpaid_count: number
}

export interface MonthlySummary {
  month: string
  totalVolume: number
  totalPayouts: number
  merchantCount: number
  eventCount: number
  byAgent: AgentSummary[]
}

export interface AgentSummary {
  agentName: string
  merchantCount: number
  totalPayout: number
  paidCount: number
  unpaidCount: number
}
