import { createClient } from "@/lib/db/server"
import { logAction, logDebug } from "@/lib/utils/history"
import { type NextRequest, NextResponse } from "next/server"
import { normalizeParticipants } from "@/lib/utils/normalize-participant"

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID()

  try {
    const body = await request.json()
    const { eventIds, mid: rawMid, participants: rawParticipants, payout_type } = body

    // IMPORTANT: Preserve MID exactly as provided - never convert to number
    // Leading zeros must be preserved
    const mid = String(rawMid || "").trim()

    if (!rawParticipants || rawParticipants.length === 0) {
      return NextResponse.json({ success: false, error: "At least one participant is required" }, { status: 400 })
    }

    // Normalize all participant fields to use consistent naming
    const participants = normalizeParticipants(rawParticipants)

    const totalSplit = participants.reduce((sum, p) => sum + p.split_pct, 0)
    if (totalSplit < 80 || totalSplit > 105) {
      return NextResponse.json(
        { success: false, error: `Total split (${totalSplit}%) should be between 80% and 105%` },
        { status: 400 },
      )
    }

    const supabase = await createClient()

    // IMPORTANT: Look up by BOTH mid AND payout_type
    // Each MID can have multiple deals (one per payout type: residual, bonus, trueup, etc.)
    const { data: existingDeal } = await supabase
      .from("deals")
      .select("*")
      .eq("mid", mid)
      .eq("payout_type", payout_type)
      .single()

    let dealId: string
    // Use consistent short deal_id format: deal_ + 8 hex chars
    const dealUniqueId = `deal_${crypto.randomUUID().slice(0, 8)}`

    // Get the primary partner name (first non-Lumino participant)
    const primaryPartner = participants.find(p => p.partner_airtable_id !== "lumino-company")
    const assignedAgentName = primaryPartner?.partner_name || participants[0]?.partner_name || null

    if (existingDeal) {
      const previousData = {
        participants_json: existingDeal.participants_json,
        payout_type: existingDeal.payout_type,
        assigned_agent_name: existingDeal.assigned_agent_name,
      }

      const { error: updateError } = await supabase
        .from("deals")
        .update({
          participants_json: participants,
          payout_type,
          assigned_agent_name: assignedAgentName,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingDeal.id)

      if (updateError) {
        await logDebug(
          "error",
          "api",
          `Failed to update deal: ${updateError.message}`,
          { mid, error: updateError },
          requestId,
        )
        return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
      }
      dealId = existingDeal.id

      await logAction({
        actionType: "update",
        entityType: "deal",
        entityId: existingDeal.id,
        entityName: mid,
        description: `Updated deal participants for ${payout_type} on MID ${mid}`,
        previousData,
        newData: { participants_json: participants, payout_type, assigned_agent_name: assignedAgentName },
        requestId,
      })
    } else {
      const { data: newDeal, error: insertError } = await supabase
        .from("deals")
        .insert({
          deal_id: dealUniqueId,
          mid,
          participants_json: participants,
          payout_type,
          assigned_agent_name: assignedAgentName,
          assigned_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (insertError || !newDeal) {
        await logDebug(
          "error",
          "api",
          `Failed to create deal: ${insertError?.message}`,
          { mid, error: insertError },
          requestId,
        )
        return NextResponse.json(
          { success: false, error: insertError?.message || "Failed to create deal" },
          { status: 500 },
        )
      }
      dealId = newDeal.id

      await logAction({
        actionType: "create",
        entityType: "deal",
        entityId: newDeal.id,
        entityName: mid,
        description: `Created new ${payout_type} deal for MID ${mid} with ${participants.length} participant(s)`,
        newData: { deal_id: dealUniqueId, mid, participants_json: participants, payout_type },
        requestId,
      })
    }

    const { error: updateEventsError } = await supabase
      .from("csv_data")
      .update({
        assignment_status: "pending",
        deal_id: dealId,
        assigned_agent_id: primaryPartner?.partner_airtable_id || participants[0]?.partner_airtable_id,
        assigned_agent_name: assignedAgentName,
        payout_type,
        updated_at: new Date().toISOString(),
      })
      .in("id", eventIds)

    if (updateEventsError) {
      await logDebug(
        "error",
        "api",
        `Failed to update events: ${updateEventsError.message}`,
        { dealId, eventIds, error: updateEventsError },
        requestId,
      )
      return NextResponse.json({ success: false, error: updateEventsError.message }, { status: 500 })
    }

    await logDebug(
      "info",
      "api",
      `Deal ${existingDeal ? "updated" : "created"} successfully`,
      { dealId, mid, eventCount: eventIds.length },
      requestId,
    )

    return NextResponse.json({
      success: true,
      data: { deal_id: dealId, events_updated: eventIds.length },
    })
  } catch (error) {
    console.error("Deal creation error:", error)
    await logDebug(
      "error",
      "api",
      `Deal creation error: ${error instanceof Error ? error.message : "Unknown"}`,
      { error },
      requestId,
    )
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const mid = searchParams.get("mid")
    const list = searchParams.get("list")
    const page = Number.parseInt(searchParams.get("page") || "1")
    const limit = Number.parseInt(searchParams.get("limit") || "100")
    const search = searchParams.get("search") || ""
    const includePending = searchParams.get("includePending") === "true"
    const confirmedOnly = searchParams.get("confirmedOnly") === "true"

    const supabase = await createClient()

    if (list === "true") {
      const offset = (page - 1) * limit

      let query = supabase.from("deals").select("*", { count: "exact" }).order("created_at", { ascending: false })

      if (search && /^\d+$/.test(search)) {
        query = query.or(`mid.ilike.%${search}%,deal_id.ilike.%${search}%,assigned_agent_name.ilike.%${search}%`)
      }

      const { data: allDeals, error } = await query

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }

      const pendingItems: any[] = []
      if (includePending) {
        const existingMids = new Set((allDeals || []).map((d) => d.mid).filter(Boolean))

        let pendingQuery = supabase
          .from("csv_data")
          .select("id, mid, merchant_name, agent_name, agent_split, created_at")
          .eq("assignment_status", "pending")
          .order("created_at", { ascending: false })

        if (search) {
          pendingQuery = pendingQuery.or(
            `mid.ilike.%${search}%,merchant_name.ilike.%${search}%,agent_name.ilike.%${search}%`,
          )
        }

        const { data: pendingData } = await pendingQuery

        if (pendingData) {
          const midGroups = new Map<string, any[]>()
          for (const item of pendingData) {
            const normalizedMid = item.mid || ""
            if (!existingMids.has(item.mid) && !existingMids.has(normalizedMid)) {
              const key = item.mid || item.id
              if (!midGroups.has(key)) {
                midGroups.set(key, [])
              }
              midGroups.get(key)!.push(item)
            }
          }

          for (const [midKey, items] of midGroups) {
            const firstItem = items[0]
            pendingItems.push({
              id: `pending_${midKey}`,
              deal_id: `pending_${midKey}`,
              mid: firstItem.mid,
              merchant_name: firstItem.merchant_name,
              assigned_agent_name: firstItem.agent_name || null,
              payout_type: "residual",
              participants_json: firstItem.agent_name
                ? [
                    {
                      partner_airtable_id: null,
                      partner_name: firstItem.agent_name,
                      partner_role: null,
                      partner_email: null,
                      split_pct: firstItem.agent_split || 50,
                    },
                  ]
                : [],
              created_at: firstItem.created_at,
              is_pending: true,
              pending_event_ids: items.map((i) => i.id),
            })
          }
        }
      }

      // Get merchant names from payouts table - payouts.deal_id stores TEXT deal_id (e.g. "deal_abc123")
      // NOT the UUID, so we need to match on deal_id TEXT field
      const dealIdTexts = (allDeals || []).map((d) => d.deal_id).filter(Boolean)
      const merchantMapByDealId: Record<string, string> = {}

      if (dealIdTexts.length > 0) {
        const { data: payouts } = await supabase
          .from("payouts")
          .select("deal_id, merchant_name")
          .in("deal_id", dealIdTexts)
        payouts?.forEach((p) => {
          if (p.deal_id && p.merchant_name && !merchantMapByDealId[p.deal_id]) {
            merchantMapByDealId[p.deal_id] = p.merchant_name
          }
        })
      }

      const dealsWithMerchants = (allDeals || []).map((deal) => {
        let parsedParticipants = deal.participants_json
        if (typeof deal.participants_json === "string") {
          try {
            parsedParticipants = JSON.parse(deal.participants_json)
          } catch (e) {
            console.error("Parse error:", e)
            parsedParticipants = []
          }
        }

        return {
          ...deal,
          // Use deal.merchant_name if it exists (new column), else fallback to payouts lookup
          merchant_name: deal.merchant_name || (deal.deal_id ? merchantMapByDealId[deal.deal_id] || null : null),
          participants_json: parsedParticipants,
          is_pending: false,
        }
      })

      let combinedResults = [...dealsWithMerchants, ...pendingItems]

      // If confirmedOnly=true, filter out deals that have NO confirmed events
      // (i.e., only show deals that have at least one confirmed csv_data event)
      if (confirmedOnly) {
        // Get ALL deal_ids that have at least one confirmed event
        const { data: confirmedDealIds } = await supabase
          .from("csv_data")
          .select("deal_id")
          .eq("assignment_status", "confirmed")
          .not("deal_id", "is", null)

        // Create a set of deal IDs (as strings) that have confirmed events
        const dealsWithConfirmedEvents = new Set(
          (confirmedDealIds || []).map((c) => String(c.deal_id))
        )

        // Filter to only include deals with confirmed events
        combinedResults = combinedResults.filter((deal) => {
          // Exclude synthetic pending items in confirmedOnly mode
          if (deal.is_pending) return false
          // Check if this deal has confirmed events (compare as strings)
          return dealsWithConfirmedEvents.has(String(deal.id))
        })
      }

      if (search) {
        const searchLower = search.toLowerCase()
        combinedResults = combinedResults.filter((deal) => {
          if (deal.mid?.toLowerCase().includes(searchLower)) return true
          if (deal.deal_id?.toLowerCase().includes(searchLower)) return true
          if (deal.assigned_agent_name?.toLowerCase().includes(searchLower)) return true
          if (deal.merchant_name?.toLowerCase().includes(searchLower)) return true
          const participants = deal.participants_json || []
          if (participants.some((p: any) => p.partner_name?.toLowerCase().includes(searchLower))) return true
          return false
        })
      }

      const total = combinedResults.length
      const paginatedDeals = combinedResults.slice(offset, offset + limit)

      return NextResponse.json({
        success: true,
        data: paginatedDeals,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      })
    }

    if (!mid) {
      return NextResponse.json({ success: false, error: "MID is required" }, { status: 400 })
    }

    const payout_type = searchParams.get("payout_type")

    // Query by MID, optionally filtered by payout_type
    // If payout_type is provided, get the exact deal for that MID+payout_type combo
    // Otherwise, return the most recent deal for this MID (for backwards compatibility)
    let query = supabase
      .from("deals")
      .select("*")
      .eq("mid", mid)

    if (payout_type) {
      query = query.eq("payout_type", payout_type)
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(1)
      .single()

    if (error && error.code !== "PGRST116") {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    if (data && typeof data.participants_json === "string") {
      try {
        data.participants_json = JSON.parse(data.participants_json)
      } catch (e) {
        console.error("Parse error:", e)
        data.participants_json = []
      }
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}
