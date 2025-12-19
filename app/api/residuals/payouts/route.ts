import { createClient } from "@/lib/db/server"
import { type NextRequest, NextResponse } from "next/server"
import type { PayoutSummary } from "@/lib/types/database"

/**
 * Payout with joined partner data from partners table
 */
interface PayoutWithPartner {
  id: string
  mid: string | null
  payout_month: string | null
  partner_payout_amount: number | null
  paid_status: string | null
  csv_data_id: string | null
  partner_split_pct: number | null
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
  [key: string]: any // Allow other fields for raw format
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const month = searchParams.get("month")
    const paidStatus = searchParams.get("status") // 'paid', 'unpaid', 'all'
    const format = searchParams.get("format") // 'raw' or 'summary' (default)
    const csvDataId = searchParams.get("csv_data_id")
    const includeZero = searchParams.get("includeZero") === "true" // New param to optionally include 0% payouts

    const supabase = await createClient()

    // Query with JOIN to partners table for partner data
    let baseQuery = supabase
      .from("payouts")
      .select(`
        *,
        partner:partners!partner_id (
          external_id,
          name,
          role
        )
      `)
      .order("payout_month", { ascending: false })

    if (!includeZero) {
      baseQuery = baseQuery.gt("partner_split_pct", 0)
    }

    if (month && month !== "all") {
      baseQuery = baseQuery.eq("payout_month", month)
    }

    if (paidStatus && paidStatus !== "all") {
      baseQuery = baseQuery.eq("paid_status", paidStatus)
    }

    if (csvDataId) {
      baseQuery = baseQuery.eq("csv_data_id", csvDataId)
    }

    const allPayouts: any[] = []
    let from = 0
    const batchSize = 1000
    let hasMore = true

    while (hasMore) {
      const { data: batch, error: batchError } = await baseQuery.range(from, from + batchSize - 1)

      if (batchError) {
        console.error("[v0] Error fetching payouts batch:", batchError)
        return NextResponse.json({ success: false, error: batchError.message }, { status: 500 })
      }

      if (batch && batch.length > 0) {
        allPayouts.push(...batch)
        from += batchSize
        hasMore = batch.length === batchSize
      } else {
        hasMore = false
      }
    }

    if (format === "raw") {
      // Get unique MIDs from payouts
      const uniqueMids = [...new Set(allPayouts.map((p) => p.mid).filter(Boolean))]

      // Fetch deals for these MIDs to get available_to_purchase status
      const { data: deals, error: dealsError } = await supabase
        .from("deals")
        .select("id, mid, available_to_purchase")
        .in("mid", uniqueMids)

      if (dealsError) {
        console.error("[v0] Error fetching deals:", dealsError)
      }

      // Create a map of mid -> deal info
      const dealsMap = new Map<string, { deal_id: string; available_to_purchase: boolean }>()
      if (deals) {
        deals.forEach((deal) => {
          if (deal.mid) {
            dealsMap.set(deal.mid, {
              deal_id: deal.id,
              available_to_purchase: deal.available_to_purchase || false,
            })
          }
        })
      }

      // Enrich payouts with deal info
      const enrichedPayouts = allPayouts.map((payout) => ({
        ...payout,
        deal_id_from_deals: dealsMap.get(payout.mid)?.deal_id || null,
        available_to_purchase: dealsMap.get(payout.mid)?.available_to_purchase || false,
      }))

      return NextResponse.json({ success: true, payouts: enrichedPayouts, data: enrichedPayouts })
    }

    // Aggregation Logic (default behavior)
    // We need to group by partner and calculate totals
    const summaryMap = new Map<string, PayoutSummary>()

    allPayouts.forEach((row: PayoutWithPartner) => {
      // Prefer joined partner data, fall back to legacy columns
      const partnerId = row.partner?.external_id || row.partner_airtable_id
      const partnerName = row.partner?.name || row.partner_name || "Unknown Partner"
      const partnerRole = row.partner?.role || row.partner_role || "Partner"
      const amount = Number.parseFloat(String(row.partner_payout_amount)) || 0
      const isPaid = row.paid_status === "paid"

      if (!partnerId) return // Skip if no partner ID

      if (!summaryMap.has(partnerId)) {
        summaryMap.set(partnerId, {
          partner_airtable_id: partnerId,
          partner_name: partnerName,
          partner_role: partnerRole,
          merchant_count: 0,
          total_payout: 0,
          paid_count: 0,
          unpaid_count: 0,
          // Using Set to count unique MIDs and roles
          _mids: new Set(),
          _roles: new Set(),
        } as any)
      }

      const summary = summaryMap.get(partnerId)!
      summary.total_payout += amount
      // @ts-ignore - internal set for counting roles
      summary._roles.add(partnerRole)

      if (isPaid) {
        summary.paid_count += 1
      } else {
        summary.unpaid_count += 1
      }

      // @ts-ignore - internal set for counting
      summary._mids.add(row.mid)
    })

    // Convert map to array and finalize counts
    const summaries: PayoutSummary[] = Array.from(summaryMap.values()).map((s: any) => ({
      partner_airtable_id: s.partner_airtable_id,
      partner_name: s.partner_name,
      partner_role: s._roles.size > 1 ? "Various" : s.partner_role,
      merchant_count: s._mids.size,
      total_payout: s.total_payout,
      paid_count: s.paid_count,
      unpaid_count: s.unpaid_count,
    }))

    // Sort by total payout desc
    summaries.sort((a, b) => b.total_payout - a.total_payout)

    return NextResponse.json({ success: true, data: summaries })
  } catch (error) {
    console.error("[v0] Error in payouts API:", error)
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
