import { createClient } from "@/lib/db/server"
import { logAction, logDebug } from "@/lib/utils/history"
import { syncPayoutsToAirtable } from "@/lib/services/airtable-sync"
import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID()

  try {
    const supabase = await createClient()
    const { partnerIds } = await request.json()

    if (!partnerIds || !Array.isArray(partnerIds) || partnerIds.length === 0) {
      return NextResponse.json({ error: "No partner IDs provided" }, { status: 400 })
    }

    const { data: payoutsBefore } = await supabase
      .from("payouts")
      .select("id, partner_airtable_id, paid_status, partner_payout_amount")
      .in("partner_airtable_id", partnerIds)
      .eq("paid_status", "unpaid")

    // Update all unpaid payouts for the selected partners
    const { data, error } = await supabase
      .from("payouts")
      .update({
        paid_status: "paid",
        paid_at: new Date().toISOString(),
      })
      .in("partner_airtable_id", partnerIds)
      .eq("paid_status", "unpaid")
      .select()

    if (error) {
      await logDebug("error", "api", `Mass mark paid failed: ${error.message}`, { partnerIds, error }, requestId)
      throw error
    }

    if (data && data.length > 0) {
      await logAction({
        actionType: "bulk_update",
        entityType: "payout",
        entityId: partnerIds.join(","),
        entityName: `${partnerIds.length} partners`,
        description: `Mass marked ${data.length} payouts as paid for ${partnerIds.length} partner(s)`,
        previousData: { payouts: payoutsBefore, paid_status: "unpaid" },
        newData: { paid_status: "paid", count: data.length, partnerIds },
        requestId,
      })
    }

    await logDebug(
      "info",
      "api",
      `Mass marked ${data?.length || 0} payouts as paid`,
      { partnerIds, count: data?.length },
      requestId,
    )

    // Sync updated payouts to Airtable
    let airtableResult = { synced: 0, error: undefined as string | undefined }
    if (data && data.length > 0) {
      const payoutIds = data.map((p) => p.id)
      airtableResult = await syncPayoutsToAirtable(payoutIds)
      
      if (airtableResult.error) {
        console.error(`[mass-mark-paid] Airtable sync failed:`, airtableResult.error)
        await logDebug(
          "warning",
          "api",
          `Mass marked ${data.length} payouts as paid but Airtable sync failed`,
          { payoutIds, airtableError: airtableResult.error },
          requestId,
        )
      }
    }

    return NextResponse.json({
      success: true,
      updated: data?.length || 0,
      message: `Marked ${data?.length || 0} payouts as paid`,
      airtable_synced: airtableResult.synced,
      airtable_error: airtableResult.error ? "Sync partially failed - will retry on next sync" : undefined,
    })
  } catch (error) {
    console.error("Error mass marking as paid:", error)
    await logDebug(
      "error",
      "api",
      `Mass mark paid error: ${error instanceof Error ? error.message : "Unknown"}`,
      { error },
      requestId,
    )
    return NextResponse.json({ error: "Failed to mass mark as paid" }, { status: 500 })
  }
}
