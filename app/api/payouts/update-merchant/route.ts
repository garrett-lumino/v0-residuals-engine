import { createClient } from "@/lib/db/server"
import { NextResponse } from "next/server"

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { oldMid: rawOldMid, newMid: rawNewMid, newMerchantName } = body

    // IMPORTANT: Preserve MID exactly as provided - never convert to number
    // Leading zeros must be preserved
    const oldMid = rawOldMid ? String(rawOldMid).trim() : undefined
    const newMid = rawNewMid !== undefined ? String(rawNewMid).trim() : undefined

    if (!oldMid) {
      return NextResponse.json({ error: "Old MID is required" }, { status: 400 })
    }

    const supabase = await createClient()

    const updateData: Record<string, string> = {}
    if (newMid !== undefined) updateData.mid = newMid
    if (newMerchantName !== undefined) updateData.merchant_name = newMerchantName

    // First, get the deal_ids from payouts with this MID (for updating deals table later)
    const { data: payoutsWithDealIds } = await supabase
      .from("payouts")
      .select("deal_id")
      .eq("mid", oldMid)

    const dealIds = [...new Set((payoutsWithDealIds || []).map(p => p.deal_id).filter(Boolean))]
    console.log(`[update-merchant] Found ${dealIds.length} deals linked to MID ${oldMid}`)

    // Update payouts table
    const { data: payoutsUpdated, error: payoutsError } = await supabase
      .from("payouts")
      .update(updateData)
      .eq("mid", oldMid)
      .select()

    if (payoutsError) {
      console.error("Error updating payouts:", payoutsError)
      throw payoutsError
    }

    // Also update csv_data table
    const { data: csvUpdated, error: csvError } = await supabase
      .from("csv_data")
      .update(updateData)
      .eq("mid", oldMid)
      .select()

    if (csvError) {
      console.error("Error updating csv_data:", csvError)
      // Don't throw - csv_data update is secondary
    }

    // Update deals table - by deal_id (UUID) since the deals MID might be different
    // This handles cases where deals.mid doesn't match payouts.mid due to formatting differences
    let dealsUpdated = 0
    if (dealIds.length > 0 && newMid !== undefined) {
      const { data: dealsData, error: dealsError } = await supabase
        .from("deals")
        .update({ mid: newMid, updated_at: new Date().toISOString() })
        .in("id", dealIds)
        .select()

      if (dealsError) {
        console.error("Error updating deals by deal_id:", dealsError)
      } else {
        dealsUpdated = dealsData?.length || 0
        console.log(`[update-merchant] Updated ${dealsUpdated} deals to MID ${newMid}`)
      }
    }

    // Also try updating deals by old MID (in case they match)
    if (newMid !== undefined) {
      const { error: dealsByMidError } = await supabase
        .from("deals")
        .update({ mid: newMid, updated_at: new Date().toISOString() })
        .eq("mid", oldMid)

      if (dealsByMidError) {
        console.error("Error updating deals by mid:", dealsByMidError)
      }
    }

    return NextResponse.json({
      success: true,
      payoutsUpdated: payoutsUpdated?.length || 0,
      csvUpdated: csvUpdated?.length || 0,
      dealsUpdated,
    })
  } catch (error) {
    console.error("Failed to update merchant:", error)
    return NextResponse.json({ error: "Failed to update merchant" }, { status: 500 })
  }
}
