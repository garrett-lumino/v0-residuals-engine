import { createClient } from "@/lib/db/server"
import { type NextRequest, NextResponse } from "next/server"
import { normalizeParticipant } from "@/lib/utils/normalize-participant"

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()

    // Get event with deal
    const { data: event, error: eventError } = await supabase
      .from("csv_data")
      .select(`
        *,
        deals (
          id,
          deal_id,
          participants_json,
          payout_type
        )
      `)
      .eq("id", id)
      .single()

    if (eventError || !event) {
      return NextResponse.json({ success: false, error: "Event not found" }, { status: 404 })
    }

    // @ts-ignore - Supabase join typing
    const deal = event.deals

    if (!deal || !deal.participants_json || deal.participants_json.length === 0) {
      return NextResponse.json({ success: false, error: "Event has no assigned participants" }, { status: 400 })
    }

    // Calculate net residual
    const netResidual = (event.volume || 0) - (event.fees || 0) - (event.adjustments || 0) - (event.chargebacks || 0)

    // Normalize and validate participants
    const normalizedParticipants = deal.participants_json.map((rawParticipant: unknown) =>
      normalizeParticipant(rawParticipant as Record<string, unknown>)
    )

    // Validate all participants have Airtable IDs
    const invalidParticipants = normalizedParticipants.filter(
      (p: any) => !p.partner_airtable_id || p.partner_airtable_id.trim() === ""
    )
    if (invalidParticipants.length > 0) {
      const names = invalidParticipants.map((p: any) => p.partner_name || "Unknown").join(", ")
      return NextResponse.json(
        { success: false, error: `Cannot confirm: Missing Airtable IDs for participants: ${names}` },
        { status: 400 }
      )
    }

    // Create payouts for each participant
    const payouts = normalizedParticipants.map((participant: any) => ({
      csv_data_id: event.id,
      deal_id: deal.deal_id,
      payout_month: event.payout_month,
      payout_date: event.date,
      mid: event.mid,
      merchant_name: event.merchant_name,
      // Use event payout_type first, fall back to deal payout_type, then default to "residual"
      payout_type: event.payout_type || deal.payout_type || "residual",
      volume: event.volume || 0,
      fees: event.fees || 0,
      adjustments: event.adjustments || 0,
      chargebacks: event.chargebacks || 0,
      net_residual: netResidual,
      partner_airtable_id: participant.partner_airtable_id,
      partner_name: participant.partner_name,
      partner_role: participant.partner_role,
      partner_split_pct: participant.split_pct,
      partner_payout_amount: netResidual * (participant.split_pct / 100),
      assignment_status: "confirmed",
      paid_status: "unpaid",
    }))

    // Insert payouts
    const { error: payoutError } = await supabase.from("payouts").insert(payouts)

    if (payoutError) {
      return NextResponse.json({ success: false, error: payoutError.message }, { status: 500 })
    }

    // Update event status
    const { error: updateError } = await supabase
      .from("csv_data")
      .update({
        assignment_status: "confirmed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)

    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      data: { payouts_created: payouts.length },
    })
  } catch (error) {
    console.error("Confirm event error:", error)
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
