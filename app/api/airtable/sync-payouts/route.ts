import { createServerClient } from "@/lib/db/server"
import { NextResponse } from "next/server"
import { logDebug, generateRequestId } from "@/lib/utils/history"

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "appRygdwVIEtbUI1C"
const AIRTABLE_TABLE_ID = process.env.AIRTABLE_TABLE_ID

/**
 * Payout with joined partner data from partners table
 * Uses the new normalized schema where partner info comes from JOIN
 */
interface PayoutWithPartner {
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
  partner: {
    external_id: string | null
    name: string
    role: string
  } | null
}

/**
 * Format payout for Airtable sync
 * Uses joined partner data when available, falls back to legacy columns
 * Field names use camelCase to match new residuals_payouts Airtable table
 */
/**
 * Format payout for Airtable sync
 * Uses joined partner data when available, falls back to legacy columns
 * Field names use snake_case to match consolidated Airtable table columns
 */
const formatPayoutForAirtable = (payout: PayoutWithPartner) => {
  const record: Record<string, any> = {
    payout_id: payout.id,
    partner_split_pct: payout.partner_split_pct || 0,
    partner_payout_amount: payout.partner_payout_amount || 0,
    volume: payout.volume || 0,
    fees: payout.fees || 0,
    net_residual: payout.net_residual || 0,
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
    record.partner_name = [partnerId]
  }
  // partner_role is a select field that works normally
  if (partnerRole) record.partner_role = partnerRole

  if (payout.paid_at) record.paid_at = payout.paid_at
  if (payout.payout_type) record.payout_type = payout.payout_type
  if (payout.assignment_status) record.status = payout.assignment_status
  if (payout.paid_status) record.paid_status = payout.paid_status

  // Boolean field - always has a value
  record.is_legacy = payout.is_legacy_import ? "Yes" : "No"

  return record
}

export async function POST(request: Request) {
  const requestId = generateRequestId()

  if (!AIRTABLE_API_KEY) {
    return NextResponse.json({ error: "Missing AIRTABLE_API_KEY environment variable" }, { status: 500 })
  }

  if (!AIRTABLE_TABLE_ID) {
    return NextResponse.json({ error: "Missing AIRTABLE_TABLE_ID environment variable" }, { status: 500 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const { month } = body

    await logDebug("info", "sync", `Starting Airtable sync${month ? ` for month ${month}` : " (all months)"}`, { month }, requestId)

    const supabase = await createServerClient()

    // Step 1: Fetch ALL payouts with joined partner data from partners table
    // Uses the new normalized schema - partner info comes from JOIN instead of denormalized columns
    let query = supabase
      .from("payouts")
      .select(`
        *,
        partner:partners!partner_id (
          external_id,
          name,
          role
        )
      `)
      .order("created_at", { ascending: false })
      .limit(10000)

    if (month) {
      query = query.eq("payout_month", month)
    }

    const { data: allPayouts, error } = await query as { data: PayoutWithPartner[] | null; error: any }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!allPayouts || allPayouts.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No payouts to sync",
        created: 0,
        updated: 0,
        total: 0,
      })
    }

    // Step 2: Fetch existing Airtable records (track ALL records per payout to detect duplicates)
    const existingRecords: Map<string, { id: string; fields: any }[]> = new Map()
    let offset: string | undefined

    do {
      const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`)
      url.searchParams.set("pageSize", "100")
      if (offset) {
        url.searchParams.set("offset", offset)
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        return NextResponse.json(
          { error: `Failed to fetch from Airtable: ${response.status} - ${errorText}` },
          { status: 500 },
        )
      }

      const data = await response.json()

      for (const record of data.records || []) {
        const payoutId = record.fields.payout_id
        if (payoutId) {
          // Track ALL records for each payout ID (to detect duplicates)
          const existing = existingRecords.get(payoutId) || []
          existing.push(record)
          existingRecords.set(payoutId, existing)
        }
      }
      offset = data.offset
    } while (offset)

    // Step 3: Determine what to create vs update, and find duplicates to delete
    const recordsToCreate: any[] = []
    const recordsToUpdate: any[] = []
    const duplicatesToDelete: string[] = []

    for (const payout of allPayouts) {
      const airtableData = formatPayoutForAirtable(payout)
      const existingRecordsList = existingRecords.get(payout.id) || []

      if (existingRecordsList.length > 0) {
        // Use the FIRST record, mark the rest as duplicates
        const primaryRecord = existingRecordsList[0]

        // Queue duplicates for deletion
        if (existingRecordsList.length > 1) {
          for (let i = 1; i < existingRecordsList.length; i++) {
            duplicatesToDelete.push(existingRecordsList[i].id)
          }
          console.log(`[sync-payouts] Found ${existingRecordsList.length - 1} duplicate(s) for payout ${payout.id}`)
        }

        // Check if any fields have changed (using snake_case field names)
        const existing = primaryRecord.fields
        const hasChanges =
          existing.paid_status !== airtableData.paid_status ||
          existing.paid_at !== airtableData.paid_at ||
          existing.status !== airtableData.status ||
          existing.partner_split_pct !== airtableData.partner_split_pct ||
          existing.partner_payout_amount !== airtableData.partner_payout_amount ||
          existing.partner_role !== airtableData.partner_role ||
          existing.partner_name !== airtableData.partner_name

        if (hasChanges) {
          recordsToUpdate.push({
            id: primaryRecord.id,
            fields: airtableData,
          })
        }
      } else {
        recordsToCreate.push({
          fields: airtableData,
        })
      }
    }

    // Step 3.5: Delete duplicates first
    let duplicatesDeleted = 0
    if (duplicatesToDelete.length > 0) {
      console.log(`[sync-payouts] Deleting ${duplicatesToDelete.length} duplicate Airtable records`)
      const batchSize = 10
      for (let i = 0; i < duplicatesToDelete.length; i += batchSize) {
        const batch = duplicatesToDelete.slice(i, i + batchSize)
        const deleteParams = batch.map((id) => `records[]=${id}`).join("&")
        const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}?${deleteParams}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
        })
        if (res.ok) duplicatesDeleted += batch.length
        await new Promise((resolve) => setTimeout(resolve, 220))
      }
    }

    // Step 4: Create new records in batches of 10
    let createdCount = 0
    const createErrors: string[] = []
    const batchSize = 10

    for (let i = 0; i < recordsToCreate.length; i += batchSize) {
      const batch = recordsToCreate.slice(i, i + batchSize)

      const createResponse = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ records: batch }),
      })

      if (createResponse.ok) {
        createdCount += batch.length
      } else {
        const errText = await createResponse.text()
        createErrors.push(`Batch ${i / batchSize}: ${errText}`)
      }

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 220))
    }

    // Step 5: Update existing records in batches of 10
    let updatedCount = 0
    const updateErrors: string[] = []

    for (let i = 0; i < recordsToUpdate.length; i += batchSize) {
      const batch = recordsToUpdate.slice(i, i + batchSize)

      const updateResponse = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ records: batch }),
      })

      if (updateResponse.ok) {
        updatedCount += batch.length
      } else {
        const errText = await updateResponse.text()
        updateErrors.push(`Batch ${i / batchSize}: ${errText}`)
      }

      await new Promise((resolve) => setTimeout(resolve, 220))
    }

    await logDebug("info", "sync", `Airtable sync complete: ${createdCount} created, ${updatedCount} updated, ${duplicatesDeleted} duplicates removed`, {
      created: createdCount,
      updated: updatedCount,
      duplicatesDeleted,
      totalPayouts: allPayouts.length,
      unchanged: allPayouts.length - createdCount - updatedCount,
    }, requestId)

    return NextResponse.json({
      success: true,
      message: `Sync complete: ${createdCount} created, ${updatedCount} updated, ${duplicatesDeleted} duplicates removed`,
      created: createdCount,
      updated: updatedCount,
      duplicatesDeleted,
      toCreate: recordsToCreate.length,
      toUpdate: recordsToUpdate.length,
      totalPayouts: allPayouts.length,
      existingAirtableRecords: existingRecords.size,
      unchanged: allPayouts.length - createdCount - updatedCount,
      tableId: AIRTABLE_TABLE_ID,
      createErrors: createErrors.length > 0 ? createErrors.slice(0, 5) : undefined,
      updateErrors: updateErrors.length > 0 ? updateErrors.slice(0, 5) : undefined,
    })
  } catch (error: any) {
    await logDebug("error", "sync", `Airtable sync failed: ${error.message}`, { error: error.message }, requestId)
    return NextResponse.json({ error: error.message || "Failed to sync payouts to Airtable" }, { status: 500 })
  }
}
