/**
 * Partners API - Lookup by Airtable ID
 *
 * GET /api/partners/by-airtable-id?id=recABC123 - Get partner by Airtable record ID
 *
 * This is a helper endpoint for the transition period when systems
 * still use Airtable IDs but need to find the corresponding internal UUID.
 */

import { createClient } from "@/lib/db/server"
import { type NextRequest, NextResponse } from "next/server"
import type { Partner } from "@/lib/types/database"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const airtableId = searchParams.get("id")

    if (!airtableId) {
      return NextResponse.json(
        { success: false, error: "Missing required parameter: id" },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const { data, error } = await supabase
      .from("partners")
      .select("*")
      .eq("external_id", airtableId)
      .eq("external_source", "airtable")
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json(
          { success: false, error: `No partner found with Airtable ID: ${airtableId}` },
          { status: 404 }
        )
      }
      console.error("[partners] Error fetching partner by Airtable ID:", error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      data: data as Partner,
      // Include mapping for convenience
      mapping: {
        airtable_id: airtableId,
        partner_id: data.id,
      },
    })
  } catch (error: any) {
    console.error("[partners] Error:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

