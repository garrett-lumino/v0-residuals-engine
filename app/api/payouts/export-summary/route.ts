import { NextResponse } from "next/server"
import { createServerClient } from "@/lib/db/server"

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
    const supabase = await createServerClient()

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
      `)
      .order("payout_month", { ascending: false }) as { data: PayoutWithPartner[] | null; error: any }

    if (error) throw error

    // Generate summary CSV (grouped by agent and month)
    const summaryMap = new Map()

    payouts?.forEach((payout) => {
      // Prefer joined partner data, fall back to legacy column
      const agentId = payout.partner?.external_id || payout.partner_airtable_id
      const key = `${agentId}_${payout.payout_month}`
      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          agent: agentId,
          month: payout.payout_month,
          totalAmount: 0,
          count: 0,
        })
      }
      const entry = summaryMap.get(key)
      entry.totalAmount += Number.parseFloat(String(payout.partner_payout_amount)) || 0
      entry.count += 1
    })

    const csvRows = [["Agent", "Month", "Total Amount", "Payout Count"]]

    summaryMap.forEach((value) => {
      csvRows.push([value.agent, value.month, value.totalAmount.toFixed(2), value.count.toString()])
    })

    const csvContent = csvRows.map((row) => row.join(",")).join("\n")

    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="payouts-summary-${new Date().toISOString().split("T")[0]}.csv"`,
      },
    })
  } catch (error: any) {
    console.error("[v0] Error exporting summary:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
