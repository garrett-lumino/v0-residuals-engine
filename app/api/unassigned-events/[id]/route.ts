import { createClient } from "@/lib/db/server"
import { type NextRequest, NextResponse } from "next/server"

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    console.log("[v0] DELETE request for event ID:", id)

    const supabase = await createClient()

    // Fetch event with all data for history logging
    const { data: event, error: fetchError } = await supabase.from("csv_data").select("*").eq("id", id).single()

    if (fetchError) {
      console.log("[v0] Error fetching event:", fetchError)
      return NextResponse.json({ error: "Event not found" }, { status: 404 })
    }

    console.log("[v0] Found event:", event?.merchant_name, "status:", event?.assignment_status)

    // Allow deletion of unassigned and pending_confirmation events
    // Confirmed events should use the /delete endpoint instead
    const allowedStatuses = ["unassigned", "pending", "pending_confirmation", null, undefined]
    if (event.assignment_status && !allowedStatuses.includes(event.assignment_status)) {
      return NextResponse.json({ error: "Can only delete unassigned or pending events" }, { status: 400 })
    }

    let dealData = null
    if (event.deal_id) {
      const { data: deal } = await supabase.from("deals").select("*").eq("id", event.deal_id).single()
      dealData = deal
    }

    const { error: payoutsError } = await supabase.from("payouts").delete().eq("csv_data_id", id)
    if (payoutsError) {
      console.log("[v0] Error deleting payouts (may not exist):", payoutsError)
    }

    if (event.deal_id) {
      const { error: dealError } = await supabase.from("deals").delete().eq("id", event.deal_id)
      if (dealError) {
        console.log("[v0] Error deleting deal:", dealError)
      }
    }

    const { error: historyError } = await supabase.from("action_history").insert({
      action_type: "delete",
      entity_type: "csv_data",
      entity_id: id,
      previous_state: {
        event: event,
        deal: dealData,
      },
      new_state: null,
      description: `Deleted event: ${event.merchant_name} (MID: ${event.mid})`,
    })

    if (historyError) {
      console.log("[v0] Error logging to history:", historyError)
    }

    // Delete the event
    const { error } = await supabase.from("csv_data").delete().eq("id", id)

    if (error) {
      console.log("[v0] Delete error:", error)
      throw error
    }

    console.log("[v0] Successfully deleted event:", id)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to delete event:", error)
    return NextResponse.json({ error: "Failed to delete event" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const { mid: rawMid, merchant_name } = body

    const supabase = await createClient()

    const updateData: Record<string, string> = {}
    // IMPORTANT: Preserve MID exactly as provided - never convert to number
    // Leading zeros must be preserved
    if (rawMid !== undefined) updateData.mid = String(rawMid).trim()
    if (merchant_name !== undefined) updateData.merchant_name = merchant_name

    const { data, error } = await supabase.from("csv_data").update(updateData).eq("id", id).select().single()

    if (error) throw error

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error("Failed to update event:", error)
    return NextResponse.json({ error: "Failed to update event" }, { status: 500 })
  }
}
