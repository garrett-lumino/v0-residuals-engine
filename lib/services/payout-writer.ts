/**
 * Payout Writer Service
 *
 * Handles payout creation with partner_id lookup and status validation.
 * Controlled by feature flags for gradual rollout.
 *
 * Features:
 * - Validates assignment_status and paid_status before writes
 * - Looks up partner_id (UUID) from partner_airtable_id
 * - Supports both single and bulk payout creation
 */

import { createClient } from "@/lib/db/server"
import { FEATURE_FLAGS } from "@/lib/config/feature-flags"
import { getPartnerIdByAirtableId, getPartnerIdsByAirtableIds } from "./partner-lookup"
import { validateAssignmentStatus, validatePaidStatus } from "@/lib/utils/validate-status"

export interface PayoutData {
  csv_data_id: string | null
  deal_id?: string | null
  mid: string
  merchant_name: string
  payout_month: string
  payout_type: string
  volume: number
  fees: number
  adjustments?: number
  chargebacks?: number
  net_residual: number
  partner_airtable_id: string
  partner_name: string
  partner_role: string
  partner_split_pct: number
  partner_payout_amount: number
  assignment_status: string
  paid_status: string
}

interface CreatePayoutResult {
  success: boolean
  id?: string
  error?: string
}

interface BulkCreateResult {
  success: boolean
  ids: string[]
  errors: string[]
}

/**
 * Create a single payout with partner_id lookup and status validation
 */
export async function createPayoutWithPartnerId(data: PayoutData): Promise<CreatePayoutResult> {
  try {
    // Validate status fields before writing
    let validatedData = { ...data }
    if (FEATURE_FLAGS.VALIDATE_STATUS_FIELDS) {
      validatedData.assignment_status = validateAssignmentStatus(data.assignment_status)
      validatedData.paid_status = validatePaidStatus(data.paid_status)
    }

    // Look up partner_id if feature enabled
    let partner_id: string | null = null
    if (FEATURE_FLAGS.WRITE_PARTNER_ID_TO_PAYOUTS && data.partner_airtable_id) {
      partner_id = await getPartnerIdByAirtableId(data.partner_airtable_id)
    }

    const supabase = await createClient()
    const { data: payout, error } = await supabase
      .from("payouts")
      .insert({
        ...validatedData,
        partner_id,
        adjustments: data.adjustments || 0,
        chargebacks: data.chargebacks || 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single()

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, id: payout.id }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

/**
 * Bulk create payouts with partner_id lookup
 * More efficient for batch operations - does a single bulk lookup
 */
export async function createPayoutsWithPartnerIds(payouts: PayoutData[]): Promise<BulkCreateResult> {
  if (!payouts || payouts.length === 0) {
    return { success: true, ids: [], errors: [] }
  }

  const errors: string[] = []

  // 1. Validate all status fields first
  if (FEATURE_FLAGS.VALIDATE_STATUS_FIELDS) {
    for (let i = 0; i < payouts.length; i++) {
      try {
        payouts[i].assignment_status = validateAssignmentStatus(payouts[i].assignment_status)
        payouts[i].paid_status = validatePaidStatus(payouts[i].paid_status)
      } catch (err: any) {
        errors.push(`Row ${i + 1} (${payouts[i].merchant_name}): ${err.message}`)
      }
    }
    if (errors.length > 0) {
      return { success: false, ids: [], errors }
    }
  }

  // 2. Bulk lookup partner_ids
  let partnerIdMap = new Map<string, string>()
  if (FEATURE_FLAGS.WRITE_PARTNER_ID_TO_PAYOUTS) {
    const airtableIds = payouts
      .map((p) => p.partner_airtable_id)
      .filter((id): id is string => !!id)

    partnerIdMap = await getPartnerIdsByAirtableIds(airtableIds)
  }

  // 3. Add partner_id to each payout
  const now = new Date().toISOString()
  const payoutsWithPartnerId = payouts.map((p) => ({
    ...p,
    partner_id: partnerIdMap.get(p.partner_airtable_id) || null,
    adjustments: p.adjustments || 0,
    chargebacks: p.chargebacks || 0,
    created_at: now,
    updated_at: now,
  }))

  // 4. Insert all payouts
  const supabase = await createClient()
  const { data, error } = await supabase.from("payouts").insert(payoutsWithPartnerId).select("id")

  if (error) {
    return { success: false, ids: [], errors: [error.message] }
  }

  return { success: true, ids: data?.map((p) => p.id) || [], errors: [] }
}

