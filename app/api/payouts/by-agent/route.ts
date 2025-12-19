import { createClient } from "@/lib/db/server"
import { type NextRequest, NextResponse } from "next/server"

/**
 * Payout with joined partner data from partners table
 */
interface PayoutWithPartner {
  partner_payout_amount: number | null
  paid_status: string | null
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

    // Get aggregated data by partner with JOIN to partners table
    const { data: payouts, error } = await supabase
      .from("payouts")
      .select(`
        partner_payout_amount,
        paid_status,
        partner_airtable_id,
        partner_name,
        partner:partners!partner_id (
          external_id,
          name,
          email
        )
      `) as { data: PayoutWithPartner[] | null; error: any }

    if (error) throw error

    // Aggregate by partner
    const agentMap = new Map<
      string,
      {
        partner_airtable_id: string
        partner_name: string
        partner_email: string
        total_payout: number
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
          line_item_count: 0,
          paid_count: 0,
          unpaid_count: 0,
        })
      }

      const agent = agentMap.get(id)!
      agent.total_payout += Number(payout.partner_payout_amount) || 0
      agent.line_item_count += 1
      if (payout.paid_status === "paid") {
        agent.paid_count += 1
      } else {
        agent.unpaid_count += 1
      }
    }

    // Convert to array and sort by total payout descending
    const agents = Array.from(agentMap.values())
      .sort((a, b) => b.total_payout - a.total_payout)
      .slice(offset, offset + limit)

    return NextResponse.json({ agents })
  } catch (error) {
    console.error("Error fetching agent data:", error)
    return NextResponse.json({ error: "Failed to fetch agent data" }, { status: 500 })
  }
}
