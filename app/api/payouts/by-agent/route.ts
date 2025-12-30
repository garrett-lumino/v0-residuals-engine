import { createClient } from "@/lib/db/server"
import { type NextRequest, NextResponse } from "next/server"

/**
 * Payout with joined partner data from partners table
 */
interface PayoutWithPartner {
  partner_payout_amount: number | null
  paid_status: string | null
  payout_month: string | null
  payout_type: string | null
  partner_role: string | null
  partner_airtable_id?: string | null
  partner_name?: string | null
  partner: {
    external_id: string | null
    name: string
    email: string | null
  } | null
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)

    const offset = Number.parseInt(searchParams.get("offset") || "0")
    const limit = Number.parseInt(searchParams.get("limit") || "50")
    const month = searchParams.get("month") // Optional month filter (e.g., "2024-11")
    const status = searchParams.get("status") // Optional status filter (paid/unpaid)
    const type = searchParams.get("type") // Optional payout type filter
    const role = searchParams.get("role") // Optional partner role filter
    const search = searchParams.get("search")?.toLowerCase() || "" // Optional search filter

    // Build query with optional month filter
    let query = supabase
      .from("payouts")
      .select(`
        partner_payout_amount,
        paid_status,
        payout_month,
        payout_type,
        partner_role,
        partner_airtable_id,
        partner_name,
        partner:partners!partner_id (
          external_id,
          name,
          email
        )
      `)

    // Apply month filter if provided
    if (month && month !== "all") {
      query = query.eq("payout_month", month)
    }

    // Apply status filter if provided
    if (status && status !== "all") {
      query = query.eq("paid_status", status)
    }

    // Apply type filter if provided
    if (type && type !== "all") {
      query = query.eq("payout_type", type)
    }

    // Apply role filter if provided
    if (role && role !== "all") {
      query = query.eq("partner_role", role)
    }

    const { data: payouts, error } = await query as { data: PayoutWithPartner[] | null; error: any }

    if (error) throw error

    // Aggregate by partner
    const agentMap = new Map<
      string,
      {
        partner_airtable_id: string
        partner_name: string
        partner_email: string
        total_payout: number
        paid_amount: number
        unpaid_amount: number
        line_item_count: number
        paid_count: number
        unpaid_count: number
      }
    >()

    for (const payout of payouts || []) {
      // Prefer joined partner data, fall back to legacy columns
      const id = payout.partner?.external_id || payout.partner_airtable_id
      const name = payout.partner?.name || payout.partner_name || "Unknown"
      const email = payout.partner?.email || ""

      if (!id) continue

      if (!agentMap.has(id)) {
        agentMap.set(id, {
          partner_airtable_id: id,
          partner_name: name,
          partner_email: email,
          total_payout: 0,
          paid_amount: 0,
          unpaid_amount: 0,
          line_item_count: 0,
          paid_count: 0,
          unpaid_count: 0,
        })
      }

      const agent = agentMap.get(id)!
      const amount = Number(payout.partner_payout_amount) || 0
      agent.total_payout += amount
      agent.line_item_count += 1
      if (payout.paid_status === "paid") {
        agent.paid_count += 1
        agent.paid_amount += amount
      } else {
        agent.unpaid_count += 1
        agent.unpaid_amount += amount
      }
    }

    // Convert to array, apply search filter, and sort by total payout descending
    let agents = Array.from(agentMap.values())

    // Apply search filter if provided
    if (search) {
      agents = agents.filter(
        (a) =>
          a.partner_name.toLowerCase().includes(search) ||
          a.partner_email.toLowerCase().includes(search) ||
          a.partner_airtable_id.toLowerCase().includes(search)
      )
    }

    agents = agents
      .sort((a, b) => b.total_payout - a.total_payout)
      .slice(offset, offset + limit)

    // Calculate totals for stats
    const allAgents = Array.from(agentMap.values())
    const totals = {
      totalAmount: allAgents.reduce((sum, a) => sum + a.total_payout, 0),
      paidAmount: allAgents.reduce((sum, a) => sum + a.paid_amount, 0),
      unpaidAmount: allAgents.reduce((sum, a) => sum + a.unpaid_amount, 0),
      totalCount: allAgents.reduce((sum, a) => sum + a.line_item_count, 0),
      paidCount: allAgents.reduce((sum, a) => sum + a.paid_count, 0),
      unpaidCount: allAgents.reduce((sum, a) => sum + a.unpaid_count, 0),
      agentCount: allAgents.length,
    }

    return NextResponse.json({ agents, totals, month: month || "all" })
  } catch (error) {
    console.error("Error fetching agent data:", error)
    return NextResponse.json({ error: "Failed to fetch agent data" }, { status: 500 })
  }
}
