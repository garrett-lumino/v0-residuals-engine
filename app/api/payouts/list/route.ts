import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/db/server"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const offset = Number.parseInt(searchParams.get("offset") || "0")
    const limit = Number.parseInt(searchParams.get("limit") || "50")

    const supabase = await createServerClient()

    const { data: payouts, error } = await supabase
      .from("payouts")
      .select("*")
      .order("payout_month", { ascending: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error

    return NextResponse.json({ payouts })
  } catch (error: any) {
    console.error("[v0] Error fetching payouts:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
