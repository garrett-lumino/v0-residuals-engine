/**
 * Airtable Sync Service
 *
 * Centralized service for syncing payouts to Airtable.
 * Consolidates duplicated logic from:
 * - /api/confirm-assignment/route.ts
 * - /api/airtable/sync-payouts/route.ts
 * - /api/airtable/compare-payouts/route.ts
 *
 * Features:
 * - Automatic duplicate detection and cleanup
 * - Batch processing with rate limiting
 * - Error tracking and reporting
 * - Consistent field formatting
 */

import { createClient } from "@/lib/db/server"

// =============================================================================
// Types
// =============================================================================

export interface PayoutWithPartner {
  id: string
  deal_id: string | null
  mid: string | null
  merchant_name: string | null
  payout_month: string | null
  payout_date: string | null
  partner_split_pct: number | null
  partner_payout_amount: number | null
  volume: number | null
  fees: number | null
  net_residual: number | null
  payout_type: string | null
  assignment_status: string | null
  paid_status: string | null
  paid_at: string | null
  is_legacy_import: boolean | null
  partner_id: string | null
  // Legacy fields (for backward compatibility during migration)
  partner_airtable_id?: string | null
  partner_name?: string | null
  partner_role?: string | null
  // Joined partner data from partners table
  partner?: {
    external_id: string | null
    name: string
    role: string
  } | null
}

export interface AirtablePayoutRecord {
  payout_id: string
  partner_split_pct: number
  partner_payout_amount: number
  volume: number
  fees: number
  net_residual: number
  deal_id?: string
  mid?: string
  merchant_name?: string
  payout_month?: string
  payout_date?: string
  partner_id?: string
  partner_name?: string
  partner_role?: string
  paid_at?: string
  payout_type?: string
  status?: string
  paid_status?: string
  is_legacy: string
}

export interface SyncResult {
  synced: number
  created: number
  updated: number
  duplicatesDeleted: number
  errors: string[]
  error?: string
}

export interface AirtableConfig {
  apiKey: string
  baseId: string
  tableId: string
}

// =============================================================================
// Constants
// =============================================================================

const AIRTABLE_BATCH_SIZE = 10 // Airtable API limit per request
const AIRTABLE_RATE_LIMIT_MS = 220 // Stay under 5 req/sec limit

// =============================================================================
// Configuration
// =============================================================================

function getAirtableConfig(): AirtableConfig | null {
  const apiKey = process.env.AIRTABLE_API_KEY
  const baseId = process.env.AIRTABLE_BASE_ID || "appRygdwVIEtbUI1C"
  const tableId = process.env.AIRTABLE_TABLE_ID

  if (!apiKey || !tableId) {
    return null
  }

  return { apiKey, baseId, tableId }
}

// =============================================================================
// Formatting
// =============================================================================

/**
 * Format payout for Airtable sync
 * Uses joined partner data when available, falls back to legacy columns
 * Field names use snake_case to match Airtable table columns
 */
export function formatPayoutForAirtable(payout: PayoutWithPartner): AirtablePayoutRecord {
  const record: AirtablePayoutRecord = {
    payout_id: payout.id,
    partner_split_pct: payout.partner_split_pct || 0,
    partner_payout_amount: payout.partner_payout_amount || 0,
    volume: payout.volume || 0,
    fees: payout.fees || 0,
    net_residual: payout.net_residual || 0,
    is_legacy: payout.is_legacy_import ? "Yes" : "No",
  }

  // Only include text/select fields if they have valid non-empty values
  // to avoid "INVALID_MULTIPLE_CHOICE_OPTIONS" errors on select fields
  if (payout.deal_id) record.deal_id = payout.deal_id
  if (payout.mid) record.mid = String(payout.mid)
  if (payout.merchant_name) record.merchant_name = payout.merchant_name
  if (payout.payout_month) record.payout_month = payout.payout_month
  if (payout.payout_date) record.payout_date = payout.payout_date

  // Partner data: prefer joined partner table, fall back to legacy columns
  const partnerId = payout.partner?.external_id || payout.partner_airtable_id
  const partnerName = payout.partner?.name || payout.partner_name
  const partnerRole = payout.partner?.role || payout.partner_role

  // partner_name is a linked record field in Airtable - expects array of record IDs
  // Only include if we have a valid Airtable record ID (starts with "rec")
  if (partnerId && partnerId.startsWith("rec")) {
    (record as any).partner_name = [partnerId]
  }
  // partner_role is a select field that works normally
  if (partnerRole) record.partner_role = partnerRole

  if (payout.paid_at) record.paid_at = payout.paid_at
  if (payout.payout_type) record.payout_type = payout.payout_type
  if (payout.assignment_status) record.status = payout.assignment_status
  if (payout.paid_status) record.paid_status = payout.paid_status

  return record
}

// =============================================================================
// Airtable API Operations
// =============================================================================

/**
 * Fetch existing Airtable records for given payout IDs
 * Returns a map of payoutId -> array of Airtable record IDs (to detect duplicates)
 */
async function fetchExistingAirtableRecords(
  config: AirtableConfig,
  payoutIds: string[]
): Promise<Map<string, string[]>> {
  const existingRecords = new Map<string, string[]>()

  if (payoutIds.length === 0) return existingRecords

  // Build filter formula - check for any of the payout IDs
  const filterParts = payoutIds.map((id) => `{payout_id}="${id}"`)
  const filterFormula = filterParts.length === 1 ? filterParts[0] : `OR(${filterParts.join(",")})`

  let offset: string | undefined

  do {
    const url = new URL(`https://api.airtable.com/v0/${config.baseId}/${config.tableId}`)
    url.searchParams.set("pageSize", "100")
    url.searchParams.set("filterByFormula", filterFormula)
    if (offset) url.searchParams.set("offset", offset)

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    })

    if (response.ok) {
      const data = await response.json()
      for (const record of data.records || []) {
        const payoutId = record.fields.payout_id
        if (payoutId) {
          const existing = existingRecords.get(payoutId) || []
          existing.push(record.id)
          existingRecords.set(payoutId, existing)
        }
      }
      offset = data.offset
    } else {
      console.error("[airtable-sync] Failed to fetch existing records:", await response.text())
      break
    }
  } while (offset)

  return existingRecords
}

/**
 * Delete duplicate Airtable records
 */
async function deleteAirtableRecords(
  config: AirtableConfig,
  recordIds: string[]
): Promise<number> {
  if (recordIds.length === 0) return 0

  let deleted = 0

  for (let i = 0; i < recordIds.length; i += AIRTABLE_BATCH_SIZE) {
    const batch = recordIds.slice(i, i + AIRTABLE_BATCH_SIZE)
    const deleteParams = batch.map((id) => `records[]=${id}`).join("&")

    const response = await fetch(
      `https://api.airtable.com/v0/${config.baseId}/${config.tableId}?${deleteParams}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${config.apiKey}` },
      }
    )

    if (response.ok) {
      deleted += batch.length
    } else {
      console.error("[airtable-sync] Delete failed:", await response.text())
    }

    await new Promise((r) => setTimeout(r, AIRTABLE_RATE_LIMIT_MS))
  }

  return deleted
}

/**
 * Create new Airtable records
 */
async function createAirtableRecords(
  config: AirtableConfig,
  records: Array<{ fields: AirtablePayoutRecord }>
): Promise<{ created: number; errors: string[] }> {
  if (records.length === 0) return { created: 0, errors: [] }

  let created = 0
  const errors: string[] = []

  for (let i = 0; i < records.length; i += AIRTABLE_BATCH_SIZE) {
    const batch = records.slice(i, i + AIRTABLE_BATCH_SIZE)

    const response = await fetch(
      `https://api.airtable.com/v0/${config.baseId}/${config.tableId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ records: batch }),
      }
    )

    if (response.ok) {
      created += batch.length
    } else {
      const errorText = await response.text()
      errors.push(`Create batch ${Math.floor(i / AIRTABLE_BATCH_SIZE)}: ${errorText}`)
      console.error("[airtable-sync] Create failed:", errorText)
    }

    await new Promise((r) => setTimeout(r, AIRTABLE_RATE_LIMIT_MS))
  }

  return { created, errors }
}

/**
 * Update existing Airtable records
 */
async function updateAirtableRecords(
  config: AirtableConfig,
  records: Array<{ id: string; fields: AirtablePayoutRecord }>
): Promise<{ updated: number; errors: string[] }> {
  if (records.length === 0) return { updated: 0, errors: [] }

  let updated = 0
  const errors: string[] = []

  for (let i = 0; i < records.length; i += AIRTABLE_BATCH_SIZE) {
    const batch = records.slice(i, i + AIRTABLE_BATCH_SIZE)

    const response = await fetch(
      `https://api.airtable.com/v0/${config.baseId}/${config.tableId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ records: batch }),
      }
    )

    if (response.ok) {
      updated += batch.length
    } else {
      const errorText = await response.text()
      errors.push(`Update batch ${Math.floor(i / AIRTABLE_BATCH_SIZE)}: ${errorText}`)
      console.error("[airtable-sync] Update failed:", errorText)
    }

    await new Promise((r) => setTimeout(r, AIRTABLE_RATE_LIMIT_MS))
  }

  return { updated, errors }
}

// =============================================================================
// Main Sync Function
// =============================================================================

/**
 * Sync payouts to Airtable
 *
 * This is the main entry point for syncing payouts. It:
 * 1. Fetches payouts from Supabase
 * 2. Fetches existing Airtable records
 * 3. Determines creates vs updates
 * 4. Deletes duplicates
 * 5. Creates/updates records
 *
 * @param payoutIds - Array of payout IDs to sync
 * @returns SyncResult with counts and errors
 */
export async function syncPayoutsToAirtable(payoutIds: string[]): Promise<SyncResult> {
  const config = getAirtableConfig()

  if (!config) {
    console.warn("[airtable-sync] Airtable not configured - skipping sync")
    return {
      synced: 0,
      created: 0,
      updated: 0,
      duplicatesDeleted: 0,
      errors: [],
      error: "Airtable not configured",
    }
  }

  if (payoutIds.length === 0) {
    return {
      synced: 0,
      created: 0,
      updated: 0,
      duplicatesDeleted: 0,
      errors: [],
    }
  }

  try {
    const supabase = await createClient()

    // 1. Fetch payouts from Supabase with joined partner data
    const { data: payouts, error } = await supabase
      .from("payouts")
      .select(`
        *,
        partner:partners!partner_id (
          external_id,
          name,
          role
        )
      `)
      .in("id", payoutIds)
      .gt("partner_split_pct", 0) // Skip 0% payouts

    if (error || !payouts || payouts.length === 0) {
      console.error("[airtable-sync] Failed to fetch payouts:", error)
      return {
        synced: 0,
        created: 0,
        updated: 0,
        duplicatesDeleted: 0,
        errors: error ? [error.message] : ["No payouts found"],
        error: error?.message || "No payouts found",
      }
    }

    // 2. Fetch existing Airtable records
    const existingRecords = await fetchExistingAirtableRecords(config, payoutIds)

    // Log duplicates
    for (const [payoutId, recordIds] of existingRecords.entries()) {
      if (recordIds.length > 1) {
        console.warn(`[airtable-sync] Duplicate detected: Payout ${payoutId} has ${recordIds.length} Airtable records`)
      }
    }

    // 3. Sort into create/update/delete buckets
    const recordsToCreate: Array<{ fields: AirtablePayoutRecord }> = []
    const recordsToUpdate: Array<{ id: string; fields: AirtablePayoutRecord }> = []
    const duplicatesToDelete: string[] = []

    for (const payout of payouts as PayoutWithPartner[]) {
      const airtableRecordIds = existingRecords.get(payout.id) || []
      const fields = formatPayoutForAirtable(payout)

      if (airtableRecordIds.length > 0) {
        // Update first record, delete duplicates
        recordsToUpdate.push({ id: airtableRecordIds[0], fields })

        if (airtableRecordIds.length > 1) {
          duplicatesToDelete.push(...airtableRecordIds.slice(1))
        }
      } else {
        recordsToCreate.push({ fields })
      }
    }

    console.log(`[airtable-sync] To create: ${recordsToCreate.length}, To update: ${recordsToUpdate.length}, Duplicates: ${duplicatesToDelete.length}`)

    // 4. Delete duplicates first
    const duplicatesDeleted = await deleteAirtableRecords(config, duplicatesToDelete)

    // 5. Create new records
    const createResult = await createAirtableRecords(config, recordsToCreate)

    // 6. Update existing records
    const updateResult = await updateAirtableRecords(config, recordsToUpdate)

    const synced = createResult.created + updateResult.updated
    const errors = [...createResult.errors, ...updateResult.errors]

    console.log(`[airtable-sync] Synced ${synced} payouts (${createResult.created} created, ${updateResult.updated} updated, ${duplicatesDeleted} duplicates deleted)`)

    return {
      synced,
      created: createResult.created,
      updated: updateResult.updated,
      duplicatesDeleted,
      errors,
      error: errors.length > 0 ? `${errors.length} batch errors occurred` : undefined,
    }
  } catch (error: any) {
    console.error("[airtable-sync] Sync error:", error)
    return {
      synced: 0,
      created: 0,
      updated: 0,
      duplicatesDeleted: 0,
      errors: [error.message],
      error: error.message,
    }
  }
}

/**
 * Sync specific fields for payouts (for partial updates like paid_status)
 * More efficient when you only need to update a few fields
 */
export async function syncPayoutFieldsToAirtable(
  payoutIds: string[],
  fieldsToSync: (keyof AirtablePayoutRecord)[]
): Promise<SyncResult> {
  // For now, just do a full sync - can optimize later if needed
  return syncPayoutsToAirtable(payoutIds)
}
