import { createServerClient } from "@/lib/db/server"
import { NextResponse } from "next/server"

/**
 * Payout with joined partner data from partners table
 */
interface PayoutWithPartner {
  id: string
  deal_id: string | null
  mid: string | null
  merchant_name: string | null
  payout_month: string | null
  payout_date: string | null
  partner_split_pct: number | null
  partner_payout_amount: number | null
  volume: number | null
  fees: number | null
  net_residual: number | null
  payout_type: string | null
  assignment_status: string | null
  paid_status: string | null
  paid_at: string | null
  is_legacy_import: boolean | null
  // Legacy fields (for backward compatibility during migration)
  partner_airtable_id?: string | null
  partner_name?: string | null
  partner_role?: string | null
  // Joined partner data from partners table
  partner: {
    external_id: string | null
    name: string
    role: string
  } | null
}

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

    // Query with JOIN to partners table for partner data
    let query = supabase
      .from("payouts")
      .select(`
        *,
        partner:partners!partner_id (
          external_id,
          name,
          role
        )
      `)
      .order("payout_date", { ascending: false })
      .limit(10000)

    if (status !== "all") {
      query = query.eq("paid_status", status)
    }

    const { data: allPayouts, error } = await query as { data: PayoutWithPartner[] | null; error: any }

    if (error) {
      console.error("[v0] Query error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log("[v0] Fetched payouts:", allPayouts?.length)

    if (!allPayouts || allPayouts.length === 0) {
      return new NextResponse("No payouts found", { status: 404 })
    }

    // Format for Airtable: one row per partner payout
    // Uses joined partner data when available, falls back to legacy columns
    const airtableRows = allPayouts.map((payout) => {
      const partnerId = payout.partner?.external_id || payout.partner_airtable_id || ""
      const partnerName = payout.partner?.name || payout.partner_name || ""
      const partnerRole = payout.partner?.role || payout.partner_role || ""

      return {
        "Payout ID": payout.id,
        "Deal ID": payout.deal_id,
        MID: payout.mid,
        "Merchant Name": payout.merchant_name,
        "Payout Month": payout.payout_month,
        "Payout Date": payout.payout_date,
        "Partner ID": partnerId,
        "Partner Name": partnerName,
        "Partner Role": partnerRole,
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
      }
    })

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
