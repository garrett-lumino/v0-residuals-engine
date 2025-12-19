/**
 * Partners API - Get and Update Single Partner
 *
 * GET /api/partners/[id] - Get partner by UUID
 * PATCH /api/partners/[id] - Update partner
 */

import { createClient } from "@/lib/db/server"
import { type NextRequest, NextResponse } from "next/server"
import type { Partner } from "@/lib/types/database"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("partners")
      .select("*")
      .eq("id", id)
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json({ success: false, error: "Partner not found" }, { status: 404 })
      }
      console.error("[partners] Error fetching partner:", error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: data as Partner })
  } catch (error: any) {
    console.error("[partners] Error:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const supabase = await createClient()

    // Build update object - only include provided fields
    const updateFields: Record<string, any> = {
      updated_at: new Date().toISOString(),
    }

    if (body.name !== undefined) updateFields.name = body.name.trim()
    if (body.email !== undefined) updateFields.email = body.email?.trim() || null
    if (body.role !== undefined) updateFields.role = body.role
    if (body.is_active !== undefined) updateFields.is_active = body.is_active
    if (body.sync_status !== undefined) updateFields.sync_status = body.sync_status

    const { data, error } = await supabase
      .from("partners")
      .update(updateFields)
      .eq("id", id)
      .select()
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json({ success: false, error: "Partner not found" }, { status: 404 })
      }
      console.error("[partners] Error updating partner:", error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: data as Partner })
  } catch (error: any) {
    console.error("[partners] Error:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

