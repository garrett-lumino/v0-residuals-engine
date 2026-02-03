import { createServerClient } from "@/lib/db/server"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status") || "all"

    const supabase = await createServerClient()

    const { count, error: countError } = await supabase.from("payouts").select("*", { count: "exact", head: true })

    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 })
    }

    console.log("[v0] Total payouts count:", count)

    let query = supabase.from("payouts").select("*").order("payout_date", { ascending: false }).limit(10000) // Explicit large limit

    if (status !== "all") {
      query = query.eq("paid_status", status)
    }

    const { data: allPayouts, error } = await query

    if (error) {
      console.error("[v0] Query error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log("[v0] Fetched payouts:", allPayouts?.length)

    if (!allPayouts || allPayouts.length === 0) {
      return new NextResponse("No payouts found", { status: 404 })
    }

    // Format for Airtable: one row per partner payout
    const airtableRows = allPayouts.map((payout) => ({
      "Payout ID": payout.id,
      "Deal ID": payout.deal_id,
      MID: payout.mid,
      "Merchant Name": payout.merchant_name,
      "Payout Month": payout.payout_month,
      "Payout Date": payout.payout_date,
      "Partner ID": payout.partner_airtable_id,
      "Partner Name": payout.partner_name || "",
      "Partner Role": payout.partner_role,
      "Split %": payout.partner_split_pct,
      "Payout Amount": payout.partner_payout_amount,
      Volume: payout.volume,
      Fees: payout.fees,
      "Net Residual": payout.net_residual,
      "Payout Type": payout.payout_type,
      Status: payout.assignment_status,
      "Paid Status": payout.paid_status,
      "Paid At": payout.paid_at,
      "Is Legacy": payout.is_legacy_import ? "Yes" : "No",
    }))

    // Convert to CSV
    const headers = Object.keys(airtableRows[0])
    const csvRows = [
      headers.join(","),
      ...airtableRows.map((row) =>
        headers
          .map((header) => {
            const value = row[header as keyof typeof row]
            if (value === null || value === undefined) return ""
            const str = String(value)
            if (str.includes(",") || str.includes('"') || str.includes("\n")) {
              return `"${str.replace(/"/g, '""')}"`
            }
            return str
          })
          .join(","),
      ),
    ]

    const csv = csvRows.join("\n")

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="airtable-payouts-${allPayouts.length}-records-${new Date().toISOString().split("T")[0]}.csv"`,
      },
    })
  } catch (error) {
    console.error("[v0] Export error:", error)
    return NextResponse.json({ error: "Failed to export payouts" }, { status: 500 })
  }
}
