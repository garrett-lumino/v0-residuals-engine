import { createClient } from "@/lib/db/server"
import { NextResponse } from "next/server"

export async function GET() {
  try {
    const supabase = await createClient()

    const { data: payouts, error } = await supabase
      .from("payouts")
      .select("payout_month, partner_airtable_id, partner_payout_amount")

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
      if (payout.partner_airtable_id) {
        data.unique_agents.add(payout.partner_airtable_id)
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
