import { createClient } from "@/lib/db/server"
import { type NextRequest, NextResponse } from "next/server"
import type { ApiResponse } from "@/lib/types/api"
import type { Deal, DealParticipant } from "@/lib/types/database"
import { normalizeParticipants } from "@/lib/utils/normalize-participant"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      eventIds,
      mid,
      participants: rawParticipants,
      payout_type,
    }: {
      eventIds: string[]
      mid: string
      participants: DealParticipant[]
      payout_type: string
    } = body

    // Validate participants
    if (!rawParticipants || rawParticipants.length === 0) {
      return NextResponse.json({ success: false, error: "At least one participant is required" }, { status: 400 })
    }

    // Normalize participant field names to canonical format
    const participants = normalizeParticipants(rawParticipants)

    // Validate split percentages
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
    // Use consistent short deal_id format: deal_ + 8 hex chars (matches other endpoints)
    const dealUniqueId = `deal_${crypto.randomUUID().slice(0, 8)}`

    // Get primary partner (first non-Lumino participant)
    const primaryPartner = participants.find(p => p.partner_airtable_id !== "lumino-company")
    const assignedAgentName = primaryPartner?.partner_name || participants[0]?.partner_name || null

    if (existingDeal) {
      // Update existing deal
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
        return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
      }

      dealId = existingDeal.id
    } else {
      // Create new deal
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
        return NextResponse.json(
          { success: false, error: insertError?.message || "Failed to create deal" },
          { status: 500 },
        )
      }

      dealId = newDeal.id
    }

    // Update csv_data records with deal assignment
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
      return NextResponse.json({ success: false, error: updateEventsError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      data: {
        deal_id: dealId,
        events_updated: eventIds.length,
      },
    })
  } catch (error) {
    console.error("Deal creation error:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

// Get deal by MID+payout_type (for pre-populating assignment modal) or paginated list of deals
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const mid = searchParams.get("mid")
    const payout_type = searchParams.get("payout_type") // NEW: allow filtering by payout_type
    const list = searchParams.get("list")
    const page = Number.parseInt(searchParams.get("page") || "1")
    const limit = Number.parseInt(searchParams.get("limit") || "100")
    const search = searchParams.get("search") || ""

    const supabase = await createClient()

    // If list=true, return paginated list of all deals
    if (list === "true") {
      const offset = (page - 1) * limit

      // This is necessary because we need to search on merchant_name and participants_json
      // which aren't directly searchable via Supabase query
      let query = supabase.from("deals").select("*", { count: "exact" }).order("created_at", { ascending: false })

      // Only use DB-level filtering for MID search (indexed field)
      // We'll do merchant/participant filtering after fetching
      if (search && /^\d+$/.test(search)) {
        // If search is numeric, it's likely a MID search - use DB filter
        query = query.or(`mid.ilike.%${search}%,deal_id.ilike.%${search}%,assigned_agent_name.ilike.%${search}%`)
      }

      const { data: allDeals, error } = await query

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }

      // Get all merchant names for lookup
      const mids = [...new Set((allDeals || []).map((d) => d.mid).filter(Boolean))]
      const merchantMap: Record<string, string> = {}
      const paidStatusMap: Record<string, string> = {}

      if (mids.length > 0) {
        const { data: payouts } = await supabase
          .from("payouts")
          .select("mid, merchant_name, paid_status")
          .in("mid", mids)

        payouts?.forEach((p) => {
          if (p.mid && p.merchant_name && !merchantMap[p.mid]) {
            merchantMap[p.mid] = p.merchant_name
          }
          if (p.mid) {
            if (p.paid_status === "paid") {
              paidStatusMap[p.mid] = "paid"
            } else if (!paidStatusMap[p.mid]) {
              paidStatusMap[p.mid] = "unpaid"
            }
          }
        })
      }

      let dealsWithMerchants = (allDeals || []).map((deal) => ({
        ...deal,
        merchant_name: deal.mid ? merchantMap[deal.mid] || null : null,
        paid_status: deal.mid ? paidStatusMap[deal.mid] || "unpaid" : "unpaid",
        participants_json:
          typeof deal.participants_json === "string" ? JSON.parse(deal.participants_json) : deal.participants_json,
      }))

      if (search) {
        const searchLower = search.toLowerCase()
        dealsWithMerchants = dealsWithMerchants.filter((deal) => {
          if (deal.mid?.toLowerCase().includes(searchLower)) return true
          if (deal.deal_id?.toLowerCase().includes(searchLower)) return true
          if (deal.assigned_agent_name?.toLowerCase().includes(searchLower)) return true
          if (deal.merchant_name?.toLowerCase().includes(searchLower)) return true
          const participants = (deal.participants_json as Array<{ partner_name?: string; partner_role?: string }>) || []
          if (participants.some((p) => p.partner_name?.toLowerCase().includes(searchLower))) return true
          return false
        })
      }

      const total = dealsWithMerchants.length
      const paginatedDeals = dealsWithMerchants.slice(offset, offset + limit)

      return NextResponse.json({
        success: true,
        data: paginatedDeals,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    }

    if (!mid) {
      return NextResponse.json({ success: false, error: "MID is required" }, { status: 400 })
    }

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

    const dealWithParsedJson = data
      ? {
          ...data,
          participants_json:
            typeof data.participants_json === "string" ? JSON.parse(data.participants_json) : data.participants_json,
        }
      : null

    const response: ApiResponse<Deal | null> = {
      success: true,
      data: dealWithParsedJson as Deal | null,
    }

    return NextResponse.json(response)
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
