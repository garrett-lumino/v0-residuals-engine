import { createClient } from "@/lib/db/server"
import { type NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)

    const offset = Number.parseInt(searchParams.get("offset") || "0")
    const limit = Number.parseInt(searchParams.get("limit") || "50")

    // Get aggregated data by partner
    const { data: payouts, error } = await supabase
      .from("payouts")
      .select("partner_airtable_id, partner_name, partner_payout_amount, paid_status")

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
      const id = payout.partner_airtable_id
      if (!id) continue

      if (!agentMap.has(id)) {
        agentMap.set(id, {
          partner_airtable_id: id,
          partner_name: payout.partner_name || "Unknown",
          partner_email: "",
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
