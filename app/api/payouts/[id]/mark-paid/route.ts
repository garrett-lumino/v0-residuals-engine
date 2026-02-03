import { createClient } from "@/lib/db/server"
import { logAction, logDebug } from "@/lib/utils/history"
import { syncPayoutsToAirtable } from "@/lib/services/airtable-sync"
import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID()
  const { id } = await params

  try {
    const supabase = await createClient()

    // Get current payout state
    const { data: payoutBefore, error: fetchError } = await supabase.from("payouts").select("*").eq("id", id).single()

    if (fetchError || !payoutBefore) {
      return NextResponse.json({ success: false, error: "Payout not found" }, { status: 404 })
    }

    const newStatus = payoutBefore.paid_status === "paid" ? "unpaid" : "paid"

    // Update payout
    const { error: updateError } = await supabase
      .from("payouts")
      .update({
        paid_status: newStatus,
        paid_at: newStatus === "paid" ? new Date().toISOString() : null,
      })
      .eq("id", id)

    if (updateError) {
      await logDebug(
        "error",
        "api",
        `Failed to toggle payout paid status: ${updateError.message}`,
        { id, error: updateError },
        requestId,
      )
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
    }

    await logAction({
      actionType: "update",
      entityType: "payout",
      entityId: id,
      entityName: `${payoutBefore.merchant_name || payoutBefore.mid} - ${payoutBefore.partner_name}`,
      description: `Marked payout as ${newStatus}`,
      previousData: { paid_status: payoutBefore.paid_status },
      newData: { paid_status: newStatus },
      requestId,
    })

    // Sync to Airtable
    const airtableResult = await syncPayoutsToAirtable([id])
    if (airtableResult.error) {
      console.error(`[mark-paid] Airtable sync failed for payout ${id}:`, airtableResult.error)
      // Log but don't fail - database update succeeded
      await logDebug(
        "warning",
        "api",
        `Payout ${id} marked as ${newStatus} but Airtable sync failed`,
        { id, airtableError: airtableResult.error },
        requestId,
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        id,
        paid_status: newStatus,
        message: `Payout marked as ${newStatus}`,
        airtable_synced: airtableResult.synced > 0,
      },
    })
  } catch (error) {
    await logDebug(
      "error",
      "api",
      `Toggle paid error: ${error instanceof Error ? error.message : "Unknown"}`,
      { error },
      requestId,
    )
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}
