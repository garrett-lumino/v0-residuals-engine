/**
 * Partners API - List and Create
 *
 * GET /api/partners - List all partners with optional filters
 * POST /api/partners - Create a new partner
 */

import { createClient } from "@/lib/db/server"
import { type NextRequest, NextResponse } from "next/server"
import type { Partner } from "@/lib/types/database"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)

    const activeOnly = searchParams.get("active") !== "false"
    const role = searchParams.get("role")
    const search = searchParams.get("search")
    const limit = parseInt(searchParams.get("limit") || "100")
    const offset = parseInt(searchParams.get("offset") || "0")

    let query = supabase
      .from("partners")
      .select("*", { count: "exact" })
      .order("name", { ascending: true })
      .range(offset, offset + limit - 1)

    if (activeOnly) {
      query = query.eq("is_active", true)
    }

    if (role) {
      query = query.eq("role", role)
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,external_id.ilike.%${search}%`)
    }

    const { data, error, count } = await query

    if (error) {
      console.error("[partners] Error fetching partners:", error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      data: data as Partner[],
      pagination: {
        total: count || 0,
        limit,
        offset,
      },
    })
  } catch (error: any) {
    console.error("[partners] Error:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const supabase = await createClient()

    // Validate required fields
    if (!body.name || body.name.trim() === "") {
      return NextResponse.json(
        { success: false, error: "Partner name is required" },
        { status: 400 }
      )
    }

    // Determine external source
    const hasExternalId = body.external_id || body.airtable_id
    const externalSource = hasExternalId ? "airtable" : "manual"

    const { data, error } = await supabase
      .from("partners")
      .insert({
        name: body.name.trim(),
        email: body.email?.trim() || null,
        role: body.role || "Partner",
        external_id: body.external_id || body.airtable_id || null,
        external_source: externalSource,
        is_active: body.is_active !== false,
        sync_status: "pending",
      })
      .select()
      .single()

    if (error) {
      // Check for unique constraint violation
      if (error.code === "23505") {
        return NextResponse.json(
          { success: false, error: "A partner with this external ID already exists" },
          { status: 409 }
        )
      }
      console.error("[partners] Error creating partner:", error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: data as Partner }, { status: 201 })
  } catch (error: any) {
    console.error("[partners] Error:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

