import { createClient } from "@/lib/db/server"
import { type NextRequest, NextResponse } from "next/server"

// Update all deals with the same MID
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ mid: string }> }) {
  try {
    const { mid: oldMid } = await params
    const body = await request.json()
    const supabase = await createClient()

    const newMid = body.mid

    // Update ALL deals with this MID
    const { data, error } = await supabase
      .from("deals")
      .update({
        ...body,
        updated_at: new Date().toISOString(),
      })
      .eq("mid", oldMid)
      .select()

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    // If MID is changing, cascade the update to payouts and csv_data
    if (newMid && newMid !== oldMid && data && data.length > 0) {
      console.log(`[deals/by-mid] MID changed from ${oldMid} to ${newMid}, cascading to related records...`)

      // Get all deal IDs that were updated
      const dealIds = data.map((d) => d.id)

      // Update payouts linked to these deals
      const { error: payoutsError } = await supabase
        .from("payouts")
        .update({ mid: newMid, updated_at: new Date().toISOString() })
        .in("deal_id", dealIds)

      if (payoutsError) {
        console.error("[deals/by-mid] Error updating payouts:", payoutsError)
      }

      // Update csv_data linked to these deals
      const { error: csvError } = await supabase
        .from("csv_data")
        .update({ mid: newMid, updated_at: new Date().toISOString() })
        .in("deal_id", dealIds)

      if (csvError) {
        console.error("[deals/by-mid] Error updating csv_data:", csvError)
      }

      // Also update payouts/csv_data that might be linked by old MID but not deal_id
      await supabase
        .from("payouts")
        .update({ mid: newMid, updated_at: new Date().toISOString() })
        .eq("mid", oldMid)

      await supabase
        .from("csv_data")
        .update({ mid: newMid, updated_at: new Date().toISOString() })
        .eq("mid", oldMid)
    }

    return NextResponse.json({ success: true, data, count: data?.length || 0 })
  } catch (error) {
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}
