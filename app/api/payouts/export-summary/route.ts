import { NextResponse } from "next/server"
import { createServerClient } from "@/lib/db/server"

export async function GET() {
  try {
    const supabase = await createServerClient()

    const { data: payouts, error } = await supabase
      .from("payouts")
      .select("*")
      .order("payout_month", { ascending: false })

    if (error) throw error

    // Generate summary CSV (grouped by agent and month)
    const summaryMap = new Map()

    payouts?.forEach((payout) => {
      const key = `${payout.partner_airtable_id}_${payout.payout_month}`
      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          agent: payout.partner_airtable_id,
          month: payout.payout_month,
          totalAmount: 0,
          count: 0,
        })
      }
      const entry = summaryMap.get(key)
      entry.totalAmount += Number.parseFloat(payout.partner_payout_amount) || 0
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
