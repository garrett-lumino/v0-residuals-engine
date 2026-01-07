import { createClient } from "@/lib/db/server"
import { NextRequest, NextResponse } from "next/server"

/**
 * POST /api/adjustments/confirm
 * Confirms pending adjustment entries by updating their status to "confirmed"
 * 
 * Body:
 * - adjustment_ids: string[] - Array of action_history IDs to confirm
 * 
 * This updates the new_data.status field from "pending" to "confirmed"
 */
export async function POST(request: NextRequest) {
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
      .select("id, new_data")
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

    return NextResponse.json({
      success: true,
      confirmed: confirmedCount,
      total: adjustment_ids.length,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (err) {
    console.error("[API] Adjustment confirm error:", err)
    return NextResponse.json(
      { error: "Failed to confirm adjustments" },
      { status: 500 }
    )
  }
}

