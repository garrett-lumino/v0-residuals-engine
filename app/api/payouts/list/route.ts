import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/db/server"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const offset = Number.parseInt(searchParams.get("offset") || "0")
    const limit = Number.parseInt(searchParams.get("limit") || "50")
    const month = searchParams.get("month")
    const status = searchParams.get("status")
    const type = searchParams.get("type")
    const role = searchParams.get("role")
    const search = searchParams.get("search")

    const supabase = await createServerClient()

    let query = supabase
      .from("payouts")
      .select("*")
      .order("payout_month", { ascending: false })
      .order("created_at", { ascending: false })

    // Apply filters
    if (month && month !== "all") {
      query = query.eq("payout_month", month)
    }
    if (status && status !== "all") {
      query = query.eq("paid_status", status)
    }
    if (type && type !== "all") {
      query = query.eq("payout_type", type)
    }
    if (role && role !== "all") {
      query = query.eq("partner_role", role)
    }
    if (search) {
      // Search across multiple fields using OR
      query = query.or(
        `merchant_name.ilike.%${search}%,partner_name.ilike.%${search}%,mid.ilike.%${search}%,deal_id.ilike.%${search}%,partner_airtable_id.ilike.%${search}%`
      )
    }

    const { data: payouts, error } = await query.range(offset, offset + limit - 1)

    if (error) throw error

    return NextResponse.json({ payouts })
  } catch (error: any) {
    console.error("[v0] Error fetching payouts:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
