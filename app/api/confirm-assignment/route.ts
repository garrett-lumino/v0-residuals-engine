import { createClient } from "@/lib/db/server"
import { type NextRequest, NextResponse } from "next/server"
import { logActionAsync, logDebug, generateRequestId } from "@/lib/utils/history"
import { normalizeParticipant } from "@/lib/utils/normalize-participant"
import { FEATURE_FLAGS } from "@/lib/config/feature-flags"
import { getPartnerIdsByAirtableIds } from "@/lib/services/partner-lookup"
import { validateAssignmentStatus, validatePaidStatus } from "@/lib/utils/validate-status"

async function syncPayoutsToAirtable(payoutIds: string[]) {
  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "appRygdwVIEtbUI1C"
  const AIRTABLE_TABLE_ID = "tblWZlEw6pM9ytA1x"

  if (!AIRTABLE_API_KEY || payoutIds.length === 0) return { synced: 0 }

  try {
    const supabase = await createClient()

    const { data: payouts, error } = await supabase
      .from("payouts")
      .select("*")
      .in("id", payoutIds)
      .gt("partner_split_pct", 0) // Skip 0% payouts

    if (error || !payouts || payouts.length === 0) {
      console.error("[confirm-assignment] Failed to fetch payouts for Airtable sync:", error)
      return { synced: 0 }
    }

    // Fetch ALL existing Airtable records for these Payout IDs to find duplicates
    // We need to check EACH payout ID individually to get accurate counts
    const existingRecords: Map<string, string[]> = new Map() // payoutId -> [airtableRecordIds]
    let offset: string | undefined

    // Build filter formula - check for any of the payout IDs
    const filterParts = payoutIds.map((id) => `{Payout ID}="${id}"`)
    const filterFormula = filterParts.length === 1 ? filterParts[0] : `OR(${filterParts.join(",")})`

    do {
      const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`)
      url.searchParams.set("pageSize", "100")
      url.searchParams.set("filterByFormula", filterFormula)
      if (offset) url.searchParams.set("offset", offset)

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
      })

      if (response.ok) {
        const data = await response.json()
        for (const record of data.records || []) {
          const payoutId = record.fields["Payout ID"]
          if (payoutId) {
            // Track ALL Airtable records for this payout ID (to detect duplicates)
            const existing = existingRecords.get(payoutId) || []
            existing.push(record.id)
            existingRecords.set(payoutId, existing)
          }
        }
        offset = data.offset
      } else {
        console.error("[confirm-assignment] Failed to fetch existing Airtable records")
        break
      }
    } while (offset)

    // Log if we found any duplicates already in Airtable
    for (const [payoutId, recordIds] of existingRecords.entries()) {
      if (recordIds.length > 1) {
        console.warn(`[confirm-assignment] DUPLICATE DETECTED: Payout ${payoutId} has ${recordIds.length} Airtable records`)
      }
    }

    // Format payouts for Airtable - only include non-empty values for select fields
    const formatPayout = (payout: any) => {
      const record: Record<string, any> = {
        "Payout ID": payout.id,
        "Split %": payout.partner_split_pct || 0,
        "Payout Amount": payout.partner_payout_amount || 0,
        Volume: payout.volume || 0,
        Fees: payout.fees || 0,
        "Net Residual": payout.net_residual || 0,
      }

      // Only include text/select fields if they have valid non-empty values
      if (payout.deal_id) record["Deal ID"] = payout.deal_id
      if (payout.mid) record["MID"] = String(payout.mid)
      if (payout.merchant_name) record["Merchant Name"] = payout.merchant_name
      if (payout.payout_month) record["Payout Month"] = payout.payout_month
      if (payout.payout_date) record["Payout Date"] = payout.payout_date
      if (payout.partner_airtable_id) record["Partner ID"] = payout.partner_airtable_id
      if (payout.partner_name) record["Partner Name"] = payout.partner_name
      if (payout.paid_at) record["Paid At"] = payout.paid_at
      if (payout.partner_role) record["Partner Role"] = payout.partner_role
      if (payout.payout_type) record["Payout Type"] = payout.payout_type
      if (payout.assignment_status) record["Status"] = payout.assignment_status
      if (payout.paid_status) record["Paid Status"] = payout.paid_status

      record["Is Legacy"] = payout.is_legacy_import ? "Yes" : "No"

      return record
    }

    const recordsToCreate: any[] = []
    const recordsToUpdate: any[] = []
    const duplicatesToDelete: string[] = [] // Airtable record IDs to delete

    for (const payout of payouts) {
      const airtableRecordIds = existingRecords.get(payout.id) || []
      const fields = formatPayout(payout)

      if (airtableRecordIds.length > 0) {
        // Use the FIRST record for update, mark the rest as duplicates to delete
        recordsToUpdate.push({ id: airtableRecordIds[0], fields })

        // If there are duplicates (more than 1 record), queue extras for deletion
        if (airtableRecordIds.length > 1) {
          duplicatesToDelete.push(...airtableRecordIds.slice(1))
          console.log(`[confirm-assignment] Will delete ${airtableRecordIds.length - 1} duplicate(s) for payout ${payout.id}`)
        }
      } else {
        recordsToCreate.push({ fields })
      }
    }

    let synced = 0
    const batchSize = 10

    // Delete duplicates first (if any found)
    if (duplicatesToDelete.length > 0) {
      console.log(`[confirm-assignment] Deleting ${duplicatesToDelete.length} duplicate Airtable records`)
      for (let i = 0; i < duplicatesToDelete.length; i += batchSize) {
        const batch = duplicatesToDelete.slice(i, i + batchSize)
        const deleteParams = batch.map((id) => `records[]=${id}`).join("&")
        await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}?${deleteParams}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
        })
        await new Promise((r) => setTimeout(r, 220))
      }
    }

    // Create new records
    for (let i = 0; i < recordsToCreate.length; i += batchSize) {
      const batch = recordsToCreate.slice(i, i + batchSize)
      const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ records: batch }),
      })
      if (res.ok) synced += batch.length
      await new Promise((r) => setTimeout(r, 220))
    }

    // Update existing records
    for (let i = 0; i < recordsToUpdate.length; i += batchSize) {
      const batch = recordsToUpdate.slice(i, i + batchSize)
      const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ records: batch }),
      })
      if (res.ok) synced += batch.length
      await new Promise((r) => setTimeout(r, 220))
    }

    console.log(`[confirm-assignment] Synced ${synced} payouts to Airtable (deleted ${duplicatesToDelete.length} duplicates)`)
    return { synced, created: recordsToCreate.length, updated: recordsToUpdate.length, duplicatesDeleted: duplicatesToDelete.length }
  } catch (error) {
    console.error("[confirm-assignment] Airtable sync error:", error)
    return { synced: 0, error }
  }
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const { event_ids } = await request.json()
    const supabase = await createClient()

    await logDebug("info", "api", `Starting bulk confirm for ${event_ids?.length || 0} events`, { eventCount: event_ids?.length }, requestId)

    const { data: events, error: fetchError } = await supabase.from("csv_data").select("*").in("id", event_ids)

    if (fetchError) {
      console.error("[confirm-assignment] Error fetching events:", fetchError)
      throw fetchError
    }

    if (!events || events.length === 0) {
      return NextResponse.json({ error: "No events found" }, { status: 404 })
    }

    // Filter out events without deals (but don't fail the whole batch)
    const eventsWithoutDeals = events.filter((e) => !e.deal_id)
    const eventsWithDeals = events.filter((e) => e.deal_id)

    if (eventsWithDeals.length === 0) {
      const mids = eventsWithoutDeals.map((e) => e.mid).join(", ")
      return NextResponse.json(
        {
          error: `Cannot confirm events without deals assigned. Please assign partners first for MIDs: ${mids}`,
          events_without_deals: eventsWithoutDeals.map((e) => ({ id: e.id, mid: e.mid, merchant: e.merchant_name })),
        },
        { status: 400 },
      )
    }

    const dealIds = eventsWithDeals.map((e) => e.deal_id).filter(Boolean)
    let dealsMap: Record<string, any> = {}

    if (dealIds.length > 0) {
      const { data: deals, error: dealsError } = await supabase.from("deals").select("*").in("id", dealIds)

      if (dealsError) {
        console.error("[confirm-assignment] Error fetching deals:", dealsError)
      } else if (deals) {
        dealsMap = Object.fromEntries(deals.map((d) => [d.id, d]))
      }
    }

    // Filter out events without participants (but don't fail the whole batch)
    const eventsWithoutParticipants = eventsWithDeals.filter((e) => {
      const deal = dealsMap[e.deal_id]
      return !deal || !deal.participants_json || deal.participants_json.length === 0
    })

    const eventsToConfirm = eventsWithDeals.filter((e) => {
      const deal = dealsMap[e.deal_id]
      return deal && deal.participants_json && deal.participants_json.length > 0
    })

    // If NO events can be confirmed, return error
    if (eventsToConfirm.length === 0) {
      const mids = eventsWithoutParticipants.map((e) => e.mid).join(", ")
      return NextResponse.json(
        {
          error: `Cannot confirm events without participants assigned. Please assign partners first for MIDs: ${mids}`,
          events_without_participants: eventsWithoutParticipants.map((e) => ({
            id: e.id,
            mid: e.mid,
            merchant: e.merchant_name,
          })),
        },
        { status: 400 },
      )
    }

    // Use eventsToConfirm from here on (not all events)
    const confirmableEventIds = eventsToConfirm.map((e) => e.id)

    const { error: updateError } = await supabase
      .from("csv_data")
      .update({
        assignment_status: "confirmed",
        updated_at: new Date().toISOString(),
      })
      .in("id", confirmableEventIds)

    if (updateError) {
      console.error("[confirm-assignment] Error updating csv_data:", updateError)
      throw updateError
    }

    logActionAsync({
      actionType: "bulk_update",
      entityType: "assignment",
      entityId: confirmableEventIds.join(","),
      entityName: `${eventsToConfirm.length} events`,
      description: `Confirmed ${eventsToConfirm.length} assignment(s)${eventsWithoutParticipants.length > 0 ? ` (skipped ${eventsWithoutParticipants.length} without participants)` : ""}`,
      previousData: { status: "pending", event_ids: confirmableEventIds },
      newData: { status: "confirmed", event_ids: confirmableEventIds, merchants: eventsToConfirm.map((e) => e.merchant_name) },
      requestId,
    })

    const { error: payoutsUpdateError } = await supabase
      .from("payouts")
      .update({
        assignment_status: "confirmed",
        updated_at: new Date().toISOString(),
      })
      .in("csv_data_id", confirmableEventIds)

    if (payoutsUpdateError) {
      console.error("[confirm-assignment] Error updating payouts:", payoutsUpdateError)
    }

    const { data: existingPayouts } = await supabase
      .from("payouts")
      .select("csv_data_id, id")
      .in("csv_data_id", confirmableEventIds)

    const eventsWithPayouts = new Set(existingPayouts?.map((p) => p.csv_data_id) || [])
    const eventsNeedingPayouts = eventsToConfirm.filter((e) => !eventsWithPayouts.has(e.id))

    const allPayoutIds: string[] = existingPayouts?.map((p) => p.id) || []
    const eventsWithBadParticipants: string[] = []

    if (eventsNeedingPayouts.length > 0) {
      console.log("[confirm-assignment] Creating missing payouts for", eventsNeedingPayouts.length, "events")

      const payoutRows = []

      for (const event of eventsNeedingPayouts) {
        const deal = dealsMap[event.deal_id]
        if (!deal || !deal.participants_json) {
          console.warn("[confirm-assignment] No deal or participants for event:", event.id)
          continue
        }

        const participants = deal.participants_json as any[]

        // Validate participants have Airtable IDs
        const normalizedParticipants = participants.map((p: any) => normalizeParticipant(p as Record<string, unknown>))
        const invalidParticipants = normalizedParticipants.filter(
          (p: any) => !p.partner_airtable_id || p.partner_airtable_id.trim() === ""
        )
        if (invalidParticipants.length > 0) {
          const names = invalidParticipants.map((p: any) => p.partner_name || "Unknown").join(", ")
          console.error("[confirm-assignment] Event", event.id, "has participants with missing Airtable IDs:", names)
          eventsWithBadParticipants.push(`${event.merchant_name || event.mid}: ${names}`)
          continue // Skip this event
        }

        const fees = Number.parseFloat(event.fees) || 0
        const adjustments = Number.parseFloat(event.adjustments) || 0
        const chargebacks = Number.parseFloat(event.chargebacks) || 0
        const netResidual = fees - adjustments - chargebacks

        for (const participant of normalizedParticipants) {
          const splitPct = participant.split_pct || 0
          const amount = (netResidual * splitPct) / 100
          payoutRows.push({
            csv_data_id: event.id,
            deal_id: deal.deal_id,
            mid: event.mid,
            merchant_name: event.merchant_name,
            payout_month: event.payout_month,
            // Use event payout_type first, fall back to deal payout_type, then default to "residual"
            payout_type: event.payout_type || deal.payout_type || "residual",
            volume: event.volume,
            fees: fees,
            adjustments: adjustments,
            chargebacks: chargebacks,
            net_residual: netResidual,
            partner_airtable_id: participant.partner_airtable_id,
            partner_role: participant.partner_role,
            partner_name: participant.partner_name,
            partner_split_pct: splitPct,
            partner_payout_amount: amount,
            assignment_status: "confirmed",
            paid_status: "unpaid",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
        }
      }

      if (payoutRows.length > 0) {
        // Look up partner_ids if feature is enabled
        let partnerIdMap = new Map<string, string>()
        if (FEATURE_FLAGS.WRITE_PARTNER_ID_TO_PAYOUTS) {
          const airtableIds = payoutRows
            .map((p) => p.partner_airtable_id)
            .filter((id): id is string => !!id)
          partnerIdMap = await getPartnerIdsByAirtableIds(airtableIds)
        }

        // Add partner_id to each payout row
        const payoutsWithPartnerId = payoutRows.map((p) => ({
          ...p,
          partner_id: partnerIdMap.get(p.partner_airtable_id) || null,
        }))

        const { data: insertedPayouts, error: insertError } = await supabase
          .from("payouts")
          .insert(payoutsWithPartnerId)
          .select("id")

        if (insertError) {
          console.error("[confirm-assignment] Error inserting payouts:", insertError)
        } else {
          console.log("[confirm-assignment] Created", payoutRows.length, "payout records")
          if (insertedPayouts) {
            allPayoutIds.push(...insertedPayouts.map((p) => p.id))
          }
        }
      }
    }

    let airtableResult = { synced: 0 }
    if (allPayoutIds.length > 0) {
      airtableResult = await syncPayoutsToAirtable(allPayoutIds)
    }

    await logDebug("info", "api", `Bulk confirm complete: ${eventsToConfirm.length} confirmed, ${eventsWithoutDeals.length + eventsWithoutParticipants.length} skipped, ${airtableResult.synced} synced to Airtable`, {
      confirmed: eventsToConfirm.length,
      skipped: eventsWithoutDeals.length + eventsWithoutParticipants.length,
      airtableSynced: airtableResult.synced,
    }, requestId)

    return NextResponse.json({
      success: true,
      confirmed: eventsToConfirm.length,
      skipped: eventsWithoutDeals.length + eventsWithoutParticipants.length,
      skipped_without_deals: eventsWithoutDeals.length,
      skipped_without_participants: eventsWithoutParticipants.length,
      skipped_missing_partner_ids: eventsWithBadParticipants.length,
      payouts_updated: !payoutsUpdateError,
      airtable_synced: airtableResult.synced,
      // Include details about skipped events so frontend can show them
      skipped_events: [
        ...eventsWithoutDeals.map((e) => ({ id: e.id, mid: e.mid, merchant: e.merchant_name, reason: "no_deal" })),
        ...eventsWithoutParticipants.map((e) => ({ id: e.id, mid: e.mid, merchant: e.merchant_name, reason: "no_participants" })),
        ...eventsWithBadParticipants.map((desc) => ({ reason: "missing_partner_ids", description: desc })),
      ],
    })
  } catch (error: any) {
    console.error("[confirm-assignment] Error:", error)
    await logDebug("error", "api", `Bulk confirm failed: ${error.message}`, { error: error.message }, requestId)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
