import { createClient } from "@/lib/db/server"
import { NextResponse } from "next/server"

/**
 * Payout with joined partner data from partners table
 */
interface PayoutWithPartner {
  payout_month: string | null
  partner_payout_amount: number | null
  partner_airtable_id?: string | null
  partner: {
    external_id: string | null
  } | null
}

export async function GET() {
  try {
    const supabase = await createClient()

    // Query with JOIN to partners table
    const { data: payouts, error } = await supabase
      .from("payouts")
      .select(`
        payout_month,
        partner_payout_amount,
        partner_airtable_id,
        partner:partners!partner_id (
          external_id
        )
      `) as { data: PayoutWithPartner[] | null; error: any }

    if (error) throw error

    // Aggregate by month
    const monthMap = new Map<
      string,
      {
        month: string
        total_amount: number
        total_payouts: number
        unique_agents: Set<string>
      }
    >()

    for (const payout of payouts || []) {
      const month = payout.payout_month
      if (!month) continue

      if (!monthMap.has(month)) {
        monthMap.set(month, {
          month,
          total_amount: 0,
          total_payouts: 0,
          unique_agents: new Set(),
        })
      }

      const data = monthMap.get(month)!
      data.total_amount += Number(payout.partner_payout_amount) || 0
      data.total_payouts += 1

      // Prefer joined partner data, fall back to legacy column
      const agentId = payout.partner?.external_id || payout.partner_airtable_id
      if (agentId) {
        data.unique_agents.add(agentId)
      }
    }

    // Convert to array and sort by month descending
    const summary = Array.from(monthMap.values())
      .map(({ month, total_amount, total_payouts, unique_agents }) => ({
        month,
        total_amount,
        total_payouts,
        unique_agents: unique_agents.size,
        average_payout: total_payouts > 0 ? total_amount / total_payouts : 0,
      }))
      .sort((a, b) => b.month.localeCompare(a.month))

    return NextResponse.json({ summary })
  } catch (error) {
    console.error("Error fetching monthly summary:", error)
    return NextResponse.json({ error: "Failed to fetch monthly summary" }, { status: 500 })
  }
}
