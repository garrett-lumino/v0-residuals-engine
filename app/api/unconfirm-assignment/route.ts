import { createClient } from "@/lib/db/server"
import { type NextRequest, NextResponse } from "next/server"
import { logActionAsync, logDebug, generateRequestId } from "@/lib/utils/history"
import { syncPayoutsToAirtable } from "@/lib/services/airtable-sync"

/**
 * Unconfirm Assignment API
 * Reverts confirmed events back to pending_confirmation status
 * This allows users to make changes after accidentally confirming
 */
export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const { event_ids } = await request.json()
    const supabase = await createClient()

    await logDebug(
      "info",
      "api",
      `Starting unconfirm for ${event_ids?.length || 0} events`,
      { eventCount: event_ids?.length },
      requestId
    )

    if (!event_ids || event_ids.length === 0) {
      return NextResponse.json({ error: "No event IDs provided" }, { status: 400 })
    }

    // Fetch the events to verify they exist and are confirmed
    const { data: events, error: fetchError } = await supabase
      .from("csv_data")
      .select("*")
      .in("id", event_ids)

    if (fetchError) {
      console.error("[unconfirm-assignment] Error fetching events:", fetchError)
      throw fetchError
    }

    if (!events || events.length === 0) {
      return NextResponse.json({ error: "No events found" }, { status: 404 })
    }

    // Filter to only confirmed events
    const confirmedEvents = events.filter((e) => e.assignment_status === "confirmed")

    if (confirmedEvents.length === 0) {
      return NextResponse.json(
        { error: "No confirmed events found to unconfirm" },
        { status: 400 }
      )
    }

    const confirmedEventIds = confirmedEvents.map((e) => e.id)

    // Update csv_data status back to pending_confirmation
    const { error: updateError } = await supabase
      .from("csv_data")
      .update({
        assignment_status: "pending_confirmation",
        updated_at: new Date().toISOString(),
      })
      .in("id", confirmedEventIds)

    if (updateError) {
      console.error("[unconfirm-assignment] Error updating csv_data:", updateError)
      throw updateError
    }

    // Update payouts status back to pending (keeping the payout records intact)
    const { data: updatedPayouts, error: payoutsUpdateError } = await supabase
      .from("payouts")
      .update({
        assignment_status: "pending",
        updated_at: new Date().toISOString(),
      })
      .in("csv_data_id", confirmedEventIds)
      .select("id")

    if (payoutsUpdateError) {
      console.error("[unconfirm-assignment] Error updating payouts:", payoutsUpdateError)
    }

    // Sync updated payouts to Airtable
    let airtableResult = { synced: 0, error: undefined as string | undefined }
    if (updatedPayouts && updatedPayouts.length > 0) {
      const payoutIds = updatedPayouts.map((p) => p.id)
      airtableResult = await syncPayoutsToAirtable(payoutIds)
      if (airtableResult.error) {
        console.error("[unconfirm-assignment] Airtable sync failed:", airtableResult.error)
      }
    }

    // Log the action for audit trail
    logActionAsync({
      actionType: "bulk_update",
      entityType: "assignment",
      entityId: confirmedEventIds.join(","),
      entityName: `${confirmedEvents.length} events`,
      description: `Unconfirmed ${confirmedEvents.length} assignment(s) - reverted to pending confirmation`,
      previousData: { status: "confirmed", event_ids: confirmedEventIds },
      newData: {
        status: "pending_confirmation",
        event_ids: confirmedEventIds,
        merchants: confirmedEvents.map((e) => e.merchant_name),
      },
      requestId,
    })

    await logDebug(
      "info",
      "api",
      `Unconfirm complete: ${confirmedEvents.length} reverted to pending`,
      { unconfirmed: confirmedEvents.length, airtableSynced: airtableResult.synced },
      requestId
    )

    return NextResponse.json({
      success: true,
      unconfirmed: confirmedEvents.length,
      payouts_updated: !payoutsUpdateError,
      airtable_synced: airtableResult.synced,
    })
  } catch (error: any) {
    console.error("[unconfirm-assignment] Error:", error)
    await logDebug(
      "error",
      "api",
      `Unconfirm failed: ${error.message}`,
      { error: error.message },
      requestId
    )
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

