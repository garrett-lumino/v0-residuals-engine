import { createClient } from "@/lib/db/server"
import { type NextRequest, NextResponse } from "next/server"
import { logActionAsync } from "@/lib/utils/history"

interface Participant {
  agent_id: string
  agent_name?: string
  agent_email?: string
  role: string
  split_pct: number
}

interface NewDeal {
  merchant_name: string
  mid: string
  payout_type: string
  participants: Participant[]
}

export async function POST(request: NextRequest) {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

  try {
    const body = await request.json()
    const { event_id, deal_id, assignment_type, new_deal, status, is_draft } = body

    console.log("[assign-event] Request:", { event_id, deal_id, assignment_type, status, is_draft })

    const supabase = await createClient()

    const { data: eventData, error: eventFetchError } = await supabase
      .from("csv_data")
      .select("*")
      .eq("id", event_id)
      .single()

    if (eventFetchError || !eventData) {
      console.error("[assign-event] Event fetch error:", eventFetchError)
      return NextResponse.json({ error: "Event not found" }, { status: 404 })
    }

    console.log("[assign-event] Event data:", {
      id: eventData.id,
      mid: eventData.mid,
      merchant_name: eventData.merchant_name,
      fees: eventData.fees,
      volume: eventData.volume,
      payout_month: eventData.payout_month,
    })

    let finalDealId = deal_id
    let participants: Participant[] = []

    if (assignment_type === "new_deal" && new_deal) {
      console.log("[assign-event] Creating/updating deal for MID:", new_deal.mid)

      // Use consistent short deal_id format: deal_ + 8 hex chars
      const generatedDealId = `deal_${crypto.randomUUID().slice(0, 8)}`

      // Validate that all participants have a valid Airtable ID
      const invalidParticipants = new_deal.participants.filter(
        (p: Participant) => !p.agent_id || p.agent_id.trim() === ""
      )
      if (invalidParticipants.length > 0) {
        const names = invalidParticipants.map((p: Participant) => p.agent_name || "Unknown").join(", ")
        console.error("[assign-event] Missing Airtable IDs for participants:", names)
        return NextResponse.json(
          { error: `Missing Airtable IDs for participants: ${names}. Please select valid partners from the dropdown.` },
          { status: 400 }
        )
      }

      // IMPORTANT: Preserve MID exactly as provided - never convert to number
      // Leading zeros must be preserved
      const midString = String(new_deal.mid || "").trim()

      const dealPayload = {
        deal_id: generatedDealId,
        mid: midString,
        payout_type: new_deal.payout_type || "residual",
        participants_json: new_deal.participants.map((p: Participant) => ({
          partner_airtable_id: p.agent_id,
          partner_name: p.agent_name,
          partner_email: p.agent_email,
          partner_role: p.role,
          split_pct: p.split_pct,
        })),
        assigned_agent_name:
          new_deal.participants.find((p: Participant) => p.agent_id !== "lumino-company")?.agent_name || null,
        assigned_at: new Date().toISOString(),
        available_to_purchase: false,
        updated_at: new Date().toISOString(),
      }

      const { data: dealData, error: dealError } = await supabase
        .from("deals")
        .upsert(
          {
            ...dealPayload,
            created_at: new Date().toISOString(),
          },
          {
            onConflict: "mid",
            ignoreDuplicates: false,
          },
        )
        .select("id, deal_id")
        .single()

      if (dealError) {
        console.error("[assign-event] Deal upsert error:", dealError)
        return NextResponse.json({ error: `Failed to create/update deal: ${dealError.message}` }, { status: 500 })
      }

      console.log("[assign-event] Deal upserted:", dealData)
      finalDealId = dealData.id
      participants = new_deal.participants
    } else if (assignment_type === "existing_deal" && deal_id) {
      const { data: existingDeal, error: dealFetchError } = await supabase
        .from("deals")
        .select("*")
        .eq("id", deal_id)
        .single()

      if (dealFetchError || !existingDeal) {
        console.error("[assign-event] Deal fetch error:", dealFetchError)
        return NextResponse.json({ error: "Deal not found" }, { status: 404 })
      }

      console.log("[assign-event] Existing deal:", existingDeal)
      const dealParticipants = existingDeal.participants_json || []
      participants = dealParticipants.map((p: any) => ({
        agent_id: p.partner_airtable_id || p.agent_id,
        agent_name: p.partner_name || p.agent_name,
        agent_email: p.partner_email || p.agent_email,
        role: p.partner_role || p.role,
        split_pct: p.split_pct,
      }))

      // Validate existing deal participants have Airtable IDs
      const invalidParticipants = participants.filter(
        (p: Participant) => !p.agent_id || p.agent_id.trim() === ""
      )
      if (invalidParticipants.length > 0) {
        const names = invalidParticipants.map((p: Participant) => p.agent_name || "Unknown").join(", ")
        console.error("[assign-event] Existing deal has missing Airtable IDs:", names)
        return NextResponse.json(
          { error: `This deal has participants with missing Airtable IDs: ${names}. Please edit the deal to fix.` },
          { status: 400 }
        )
      }

      finalDealId = deal_id
    }

    const finalStatus = is_draft ? "unassigned" : "pending"

    const primaryPartner = participants.find((p) => p.agent_id !== "lumino-company")

    const updateData: any = {
      deal_id: finalDealId,
      assignment_status: finalStatus,
      payout_type: new_deal?.payout_type || eventData.payout_type || "residual",
      updated_at: new Date().toISOString(),
    }

    if (primaryPartner) {
      updateData.assigned_agent_id = primaryPartner.agent_id
      updateData.assigned_agent_name = primaryPartner.agent_name || primaryPartner.agent_id
    }

    console.log("[assign-event] Updating csv_data:", updateData)

    const { error: updateError } = await supabase.from("csv_data").update(updateData).eq("id", event_id)

    if (updateError) {
      console.error("[assign-event] csv_data update error:", updateError)
      return NextResponse.json({ error: `Failed to update event: ${updateError.message}` }, { status: 500 })
    }

    // NOTE: Payouts are NOT created here - they are created in confirm-assignment
    // This endpoint only creates/updates deals and sets status to "pending"
    // Payouts should only exist after deals are finalized/confirmed

    console.log("[assign-event] Success! Deal ID:", finalDealId, "Status:", finalStatus)

    logActionAsync({
      actionType: assignment_type === "new_deal" ? "create" : "update",
      entityType: "assignment",
      entityId: event_id,
      entityName: eventData.merchant_name || eventData.mid,
      description: `Assigned ${eventData.merchant_name || eventData.mid} to ${participants.map((p) => p.agent_name || p.agent_id).join(", ")}`,
      previousData: { assignment_status: eventData.assignment_status, deal_id: eventData.deal_id },
      newData: { assignment_status: finalStatus, deal_id: finalDealId, participants },
      requestId,
    })

    return NextResponse.json({
      success: true,
      deal_id: finalDealId,
      status: finalStatus,
      participants_count: participants.length,
    })
  } catch (error: any) {
    console.error("[assign-event] Error:", error)
    return NextResponse.json({ error: error.message || "Failed to assign event" }, { status: 500 })
  }
}
