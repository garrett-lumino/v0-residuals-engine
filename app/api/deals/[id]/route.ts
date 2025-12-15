import { createClient } from "@/lib/db/server"
import { type NextRequest, NextResponse } from "next/server"
import { logActionAsync } from "@/lib/utils/history"
import { normalizeParticipant } from "@/lib/utils/normalize-participant"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const { data, error } = await supabase.from("deals").select("*").eq("id", id).single()

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    // PARSE STRING TO ARRAY
    if (data && typeof data.participants_json === "string") {
      try {
        data.participants_json = JSON.parse(data.participants_json)
      } catch (e) {
        data.participants_json = []
      }
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`

  try {
    const { id } = await params
    const body = await request.json()
    const supabase = await createClient()

    // Validate participants_json if provided
    if (body.participants_json && Array.isArray(body.participants_json)) {
      const invalidParticipants = body.participants_json.filter(
        (p: any) => !p.partner_airtable_id || p.partner_airtable_id.trim() === ""
      )
      if (invalidParticipants.length > 0) {
        const names = invalidParticipants.map((p: any) => p.partner_name || "Unknown").join(", ")
        console.error("[deals PATCH] Missing Airtable IDs for participants:", names)
        return NextResponse.json(
          { success: false, error: `Missing Airtable IDs for participants: ${names}. Please select valid partners.` },
          { status: 400 }
        )
      }
    }

    const { data: dealBefore } = await supabase.from("deals").select("*").eq("id", id).single()
    const oldMid = dealBefore?.mid
    // IMPORTANT: Preserve MID exactly as provided - never convert to number
    // Leading zeros must be preserved
    const newMid = body.mid !== undefined ? String(body.mid).trim() : undefined

    // Update the deal - ensure MID is preserved as string
    const updatePayload = {
      ...body,
      updated_at: new Date().toISOString(),
    }
    if (newMid !== undefined) {
      updatePayload.mid = newMid // Use the sanitized string version
    }

    const { data, error } = await supabase
      .from("deals")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    // If MID changed, cascade update to payouts and csv_data
    if (newMid && newMid !== oldMid) {
      console.log(`[deals PATCH] MID changed from ${oldMid} to ${newMid}, cascading to related records...`)

      // Update payouts linked to this deal
      const { error: payoutsError } = await supabase
        .from("payouts")
        .update({ mid: newMid, updated_at: new Date().toISOString() })
        .eq("deal_id", id)

      if (payoutsError) {
        console.error("[deals PATCH] Error updating payouts:", payoutsError)
      }

      // Update csv_data linked to this deal
      const { error: csvError } = await supabase
        .from("csv_data")
        .update({ mid: newMid, updated_at: new Date().toISOString() })
        .eq("deal_id", id)

      if (csvError) {
        console.error("[deals PATCH] Error updating csv_data:", csvError)
      }
    }

    // PARSE STRING TO ARRAY
    if (data && typeof data.participants_json === "string") {
      try {
        data.participants_json = JSON.parse(data.participants_json)
      } catch (e) {
        data.participants_json = []
      }
    }

    logActionAsync({
      actionType: "update",
      entityType: "deal",
      entityId: id,
      entityName: dealBefore?.mid || id,
      description: `Updated deal ${dealBefore?.mid || id}`,
      previousData: dealBefore,
      newData: data,
      requestId,
    })

    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}

// PUT handler - used by EditPendingDealModal to update participants
// This also updates the associated payouts to match the new participants
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`

  try {
    const { id } = await params
    const body = await request.json()
    const supabase = await createClient()

    // Get the deal before update
    const { data: dealBefore, error: fetchError } = await supabase
      .from("deals")
      .select("*")
      .eq("id", id)
      .single()

    if (fetchError || !dealBefore) {
      return NextResponse.json({ success: false, error: "Deal not found" }, { status: 404 })
    }

    // Normalize participants from the request body
    // Frontend sends { participants: [...] } but DB needs { participants_json: [...] }
    const rawParticipants = body.participants || body.participants_json || []
    const normalizedParticipants = rawParticipants.map(normalizeParticipant)

    // Validate that all participants have Airtable IDs
    const invalidParticipants = normalizedParticipants.filter(
      (p: any) => !p.partner_airtable_id || p.partner_airtable_id.trim() === ""
    )
    if (invalidParticipants.length > 0) {
      const names = invalidParticipants.map((p: any) => p.partner_name || "Unknown").join(", ")
      console.error("[PUT deals] Missing Airtable IDs for participants:", names)
      return NextResponse.json(
        { success: false, error: `Missing Airtable IDs for participants: ${names}. Please select valid partners.` },
        { status: 400 }
      )
    }

    // Update the deal with normalized participants
    const { data: updatedDeal, error: updateError } = await supabase
      .from("deals")
      .update({
        participants_json: normalizedParticipants,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
    }

    // CRITICAL: Also update the associated payouts to match the new participants
    // First, delete existing payouts for this deal
    const { error: deletePayoutsError } = await supabase
      .from("payouts")
      .delete()
      .eq("deal_id", id)

    if (deletePayoutsError) {
      console.error("[PUT deals] Error deleting old payouts:", deletePayoutsError)
    }

    // Then create new payouts based on the updated participants
    if (normalizedParticipants.length > 0 && dealBefore.csv_data_id) {
      const newPayouts = normalizedParticipants.map((participant: ReturnType<typeof normalizeParticipant>) => ({
        deal_id: id,
        csv_data_id: dealBefore.csv_data_id,
        partner_airtable_id: participant.partner_airtable_id,
        partner_name: participant.partner_name,
        partner_role: participant.partner_role,
        split_pct: participant.split_pct,
        amount: dealBefore.total_amount
          ? Number(dealBefore.total_amount) * (participant.split_pct / 100)
          : 0,
        status: dealBefore.status === "confirmed" ? "confirmed" : "pending",
        residual_month: dealBefore.residual_month,
      }))

      const { error: insertPayoutsError } = await supabase
        .from("payouts")
        .insert(newPayouts)

      if (insertPayoutsError) {
        console.error("[PUT deals] Error creating new payouts:", insertPayoutsError)
        // Don't fail the whole request, deal was updated successfully
      }
    }

    // Parse participants_json if it's a string (for response)
    if (updatedDeal && typeof updatedDeal.participants_json === "string") {
      try {
        updatedDeal.participants_json = JSON.parse(updatedDeal.participants_json)
      } catch {
        updatedDeal.participants_json = []
      }
    }

    logActionAsync({
      actionType: "update",
      entityType: "deal",
      entityId: id,
      entityName: dealBefore?.mid || id,
      description: `Updated deal participants for ${dealBefore?.mid || id}`,
      previousData: dealBefore,
      newData: updatedDeal,
      requestId,
    })

    return NextResponse.json({ success: true, data: updatedDeal })
  } catch (error) {
    console.error("[PUT deals] Error:", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`

  try {
    const { id } = await params
    const supabase = await createClient()

    const { data: dealBefore } = await supabase.from("deals").select("*").eq("id", id).single()

    const { error: payoutsError } = await supabase.from("payouts").delete().eq("deal_id", id)
    if (payoutsError) console.error("Error deleting payouts:", payoutsError)

    // DELETE csv_data records linked to this deal (not reset - full delete)
    const { error: csvError } = await supabase
      .from("csv_data")
      .delete()
      .eq("deal_id", id)

    if (csvError) console.error("Error deleting csv_data:", csvError)

    const { error } = await supabase.from("deals").delete().eq("id", id)

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    logActionAsync({
      actionType: "delete",
      entityType: "deal",
      entityId: id,
      entityName: dealBefore?.mid || id,
      description: `Deleted deal ${dealBefore?.mid || id}`,
      previousData: dealBefore,
      newData: null,
      requestId,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}
