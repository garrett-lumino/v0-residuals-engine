import { createClient } from "@/lib/db/server"
import { NextRequest, NextResponse } from "next/server"

/**
 * POST /api/adjustments/reject
 * Rejects/cancels pending adjustment entries by marking them as undone
 * 
 * Body:
 * - adjustment_ids: string[] - Array of action_history IDs to reject
 * - reason?: string - Optional reason for rejection
 * 
 * This sets is_undone = true and updates new_data.status to "rejected"
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { adjustment_ids, reason } = body

    if (!adjustment_ids || !Array.isArray(adjustment_ids) || adjustment_ids.length === 0) {
      return NextResponse.json(
        { error: "Missing required field: adjustment_ids (array of IDs)" },
        { status: 400 }
      )
    }

    console.log("[API] Rejecting adjustments:", adjustment_ids, "Reason:", reason)

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

    // Update each record: set is_undone = true and update status
    let rejectedCount = 0
    const errors: string[] = []

    for (const record of records) {
      const updatedNewData = {
        ...record.new_data,
        status: "rejected",
        rejection_reason: reason || "Manually rejected",
        rejected_at: new Date().toISOString(),
      }

      const { error: updateError } = await supabase
        .from("action_history")
        .update({ 
          new_data: updatedNewData,
          is_undone: true,
        })
        .eq("id", record.id)

      if (updateError) {
        console.error(`[API] Error rejecting adjustment ${record.id}:`, updateError)
        errors.push(`Failed to reject ${record.id}: ${updateError.message}`)
      } else {
        rejectedCount++
      }
    }

    // Log the rejection action
    await supabase.from("action_history").insert({
      action_type: "reject",
      entity_type: "adjustment_batch",
      entity_id: adjustment_ids[0], // Reference first ID
      entity_name: `Rejected ${rejectedCount} adjustment(s)`,
      previous_data: { status: "pending" },
      new_data: { 
        status: "rejected",
        rejected_ids: adjustment_ids,
        rejected_count: rejectedCount,
        reason: reason || "Manually rejected",
      },
      description: `Rejected ${rejectedCount} pending adjustment(s)${reason ? `: ${reason}` : ""}`,
      is_undone: false,
    })

    return NextResponse.json({
      success: true,
      rejected: rejectedCount,
      total: adjustment_ids.length,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (err) {
    console.error("[API] Adjustment reject error:", err)
    return NextResponse.json(
      { error: "Failed to reject adjustments" },
      { status: 500 }
    )
  }
}

