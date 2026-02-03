import { createClient } from "@/lib/db/server"
import { NextResponse } from "next/server"

/**
 * GET /api/adjustments/summary
 * Returns adjustment counts per deal_id for displaying badges
 * This is a lightweight endpoint that only returns counts, not full records
 *
 * Counts are GROUPED by timestamp (minute) + status to match the UI grouping logic.
 * Multiple participants adjusted at the same time count as 1 adjustment batch.
 */
export async function GET() {
  try {
    const supabase = await createClient()

    // Query adjustment records from action_history
    // Adjustments are either:
    // 1. entity_type = 'deal' with new_data->adjustment_type set
    // 2. entity_type = 'assignment'
    // We need created_at for grouping by timestamp
    const { data, error } = await supabase
      .from("action_history")
      .select("entity_id, new_data, created_at")
      .eq("is_undone", false)
      .or("entity_type.eq.assignment,and(entity_type.eq.deal,new_data->adjustment_type.not.is.null)")

    if (error) {
      console.error("[API] Adjustment summary error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // First, group records into adjustment batches (same deal + timestamp minute + status)
    // This matches the frontend grouping logic in getDealAdjustmentGroups
    const batchesByDeal: Record<string, Set<string>> = {} // deal_id -> Set of batch keys
    const pendingBatchesByDeal: Record<string, Set<string>> = {} // deal_id -> Set of pending batch keys

    for (const record of data || []) {
      // Get deal_id from new_data.deal_id or entity_id
      const dealId = record.new_data?.deal_id || record.entity_id
      if (!dealId) continue

      // Truncate timestamp to minute for grouping (matches frontend logic)
      const timestamp = new Date(record.created_at)
      timestamp.setSeconds(0, 0)
      const timestampKey = timestamp.getTime()

      const status = record.new_data?.status || "confirmed"

      // Create a unique batch key: timestamp + status
      const batchKey = `${timestampKey}_${status}`

      // Initialize sets if needed
      if (!batchesByDeal[dealId]) {
        batchesByDeal[dealId] = new Set()
        pendingBatchesByDeal[dealId] = new Set()
      }

      // Add this batch key to the deal's set of batches
      batchesByDeal[dealId].add(batchKey)

      // Track pending batches separately
      if (status === "pending") {
        pendingBatchesByDeal[dealId].add(batchKey)
      }
    }

    // Convert to summary format (count unique batches, not individual records)
    const summary: Record<string, { total: number; pending: number }> = {}

    for (const dealId of Object.keys(batchesByDeal)) {
      summary[dealId] = {
        total: batchesByDeal[dealId].size,
        pending: pendingBatchesByDeal[dealId].size,
      }
    }

    return NextResponse.json({
      success: true,
      summary,
    })
  } catch (err) {
    console.error("[API] Adjustment summary error:", err)
    return NextResponse.json({ error: "Failed to fetch adjustment summary" }, { status: 500 })
  }
}

