import { createClient } from "@/lib/db/server"
import { NextRequest, NextResponse } from "next/server"
import { syncPayoutsToAirtable } from "@/lib/services/airtable-sync"
import { logDebug } from "@/lib/utils/history"

/**
 * POST /api/adjustments/confirm
 * Confirms pending adjustment entries by updating their status to "confirmed"
 * 
 * Body:
 * - adjustment_ids: string[] - Array of action_history IDs to confirm
 * 
 * This updates the new_data.status field from "pending" to "confirmed"
 * and syncs related payouts to Airtable
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID()
  
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { adjustment_ids } = body

    if (!adjustment_ids || !Array.isArray(adjustment_ids) || adjustment_ids.length === 0) {
      return NextResponse.json(
        { error: "Missing required field: adjustment_ids (array of IDs)" },
        { status: 400 }
      )
    }

    console.log("[API] Confirming adjustments:", adjustment_ids)

    // Fetch the current records to get their new_data
    const { data: records, error: fetchError } = await supabase
      .from("action_history")
      .select("id, new_data, entity_id")
      .in("id", adjustment_ids)
      .eq("is_undone", false)

    if (fetchError) {
      console.error("[API] Error fetching adjustment records:", fetchError)
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    if (!records || records.length === 0) {
      return NextResponse.json(
        { error: "No valid adjustment records found" },
        { status: 404 }
      )
    }

    // Update each record's new_data.status to "confirmed"
    let confirmedCount = 0
    const errors: string[] = []
    const confirmedAt = new Date().toISOString()
    const affectedDealIds = new Set<string>()

    for (const record of records) {
      const updatedNewData = {
        ...record.new_data,
        status: "confirmed",
        confirmed_at: confirmedAt,
      }

      const { error: updateError } = await supabase
        .from("action_history")
        .update({ new_data: updatedNewData })
        .eq("id", record.id)

      if (updateError) {
        console.error(`[API] Error confirming adjustment ${record.id}:`, updateError)
        errors.push(`Failed to confirm ${record.id}: ${updateError.message}`)
      } else {
        confirmedCount++
        // Collect deal IDs for Airtable sync
        const dealId = record.new_data?.deal_id || record.entity_id
        if (dealId) {
          affectedDealIds.add(dealId)
        }
      }
    }

    // Log the confirmation action
    await supabase.from("action_history").insert({
      action_type: "confirm",
      entity_type: "adjustment_batch",
      entity_id: adjustment_ids[0], // Reference first ID
      entity_name: `Confirmed ${confirmedCount} adjustment(s)`,
      previous_data: { status: "pending" },
      new_data: { 
        status: "confirmed", 
        confirmed_ids: adjustment_ids,
        confirmed_count: confirmedCount 
      },
      description: `Confirmed ${confirmedCount} pending adjustment(s)`,
      is_undone: false,
    })

    // Sync related payouts to Airtable
    let airtableResult = { synced: 0, error: undefined as string | undefined }
    if (affectedDealIds.size > 0) {
      // Find payouts for the affected deals
      const { data: relatedPayouts, error: payoutsError } = await supabase
        .from("payouts")
        .select("id")
        .in("deal_id", Array.from(affectedDealIds))
      
      if (payoutsError) {
        console.error("[API] Error fetching related payouts:", payoutsError)
        await logDebug(
          "warning",
          "api",
          `Adjustment confirmation succeeded but failed to fetch related payouts for sync`,
          { affectedDealIds: Array.from(affectedDealIds), error: payoutsError.message },
          requestId,
        )
      } else if (relatedPayouts && relatedPayouts.length > 0) {
        const payoutIds = relatedPayouts.map(p => p.id)
        console.log(`[API] Syncing ${payoutIds.length} related payouts to Airtable for ${affectedDealIds.size} deals`)
        
        airtableResult = await syncPayoutsToAirtable(payoutIds)
        
        if (airtableResult.error) {
          console.error("[API] Airtable sync failed:", airtableResult.error)
          await logDebug(
            "warning",
            "api",
            `Adjustment confirmation succeeded but Airtable sync failed`,
            { payoutIds, airtableError: airtableResult.error },
            requestId,
          )
        }
      }
    }

    return NextResponse.json({
      success: true,
      confirmed: confirmedCount,
      total: adjustment_ids.length,
      errors: errors.length > 0 ? errors : undefined,
      airtable_synced: airtableResult.synced,
      airtable_error: airtableResult.error ? "Sync failed - will retry on next sync" : undefined,
    })
  } catch (err) {
    console.error("[API] Adjustment confirm error:", err)
    await logDebug(
      "error",
      "api",
      `Adjustment confirm error: ${err instanceof Error ? err.message : "Unknown"}`,
      { error: err },
      requestId,
    )
    return NextResponse.json(
      { error: "Failed to confirm adjustments" },
      { status: 500 }
    )
  }
}

