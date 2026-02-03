import { createClient } from "@/lib/db/server"
import { type NextRequest, NextResponse } from "next/server"

function isUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(str)
}

// Get single deal
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const column = isUUID(id) ? "id" : "deal_id"
    const { data, error } = await supabase.from("deals").select("*").eq(column, id).single()

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}

// Update deal
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const supabase = await createClient()

    const column = isUUID(id) ? "id" : "deal_id"

    // First, get the current deal to check if participants_json or MID is being updated
    const { data: currentDeal } = await supabase.from("deals").select("*").eq(column, id).single()

    if (!currentDeal) {
      return NextResponse.json({ success: false, error: "Deal not found" }, { status: 404 })
    }

    const oldMid = currentDeal.mid
    // IMPORTANT: Preserve MID exactly as provided - never convert to number
    // Leading zeros must be preserved
    const newMid = body.mid !== undefined ? String(body.mid).trim() : undefined

    // If MID is changing, check for existing deal with new MID
    if (newMid && newMid !== oldMid) {
      const { data: existingDealWithMid } = await supabase
        .from("deals")
        .select("id, deal_id")
        .eq("mid", newMid)
        .neq("id", currentDeal.id)
        .single()

      if (existingDealWithMid) {
        return NextResponse.json(
          {
            success: false,
            error: `A deal already exists with MID ${newMid} (${existingDealWithMid.deal_id}). Delete or merge that deal first.`
          },
          { status: 400 }
        )
      }
    }

    // Update the deal - ensure MID is preserved as string
    const updatePayload = {
      ...body,
      updated_at: new Date().toISOString(),
    }
    if (newMid !== undefined) {
      updatePayload.mid = newMid // Use the sanitized string version
    }

    const { data, error } = await supabase
      .from("deals")
      .update(updatePayload)
      .eq(column, id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    // If MID changed, update all related records
    if (newMid && newMid !== oldMid) {
      console.log(`[deals API] MID changed from ${oldMid} to ${newMid}, updating related records...`)

      // Update payouts with old MID that belong to this deal
      const { error: payoutsError } = await supabase
        .from("payouts")
        .update({ mid: newMid, updated_at: new Date().toISOString() })
        .eq("deal_id", currentDeal.id)

      if (payoutsError) {
        console.error("[deals API] Error updating payouts MID:", payoutsError)
      }

      // Update csv_data with old MID that belong to this deal
      const { error: csvError } = await supabase
        .from("csv_data")
        .update({ mid: newMid, updated_at: new Date().toISOString() })
        .eq("deal_id", currentDeal.id)

      if (csvError) {
        console.error("[deals API] Error updating csv_data MID:", csvError)
      }

      console.log(`[deals API] Updated MID from ${oldMid} to ${newMid} for deal ${currentDeal.id}`)
    }

    if (body.participants_json && currentDeal) {
      const newParticipants = body.participants_json as any[]
      const dealUUID = data.id || currentDeal.id
      const dealTextId = data.deal_id || currentDeal.deal_id // Text ID like "deal_abc123"

      // Get all payouts for this deal - payouts table uses TEXT deal_id, not UUID
      const { data: existingPayouts } = await supabase.from("payouts").select("*").eq("deal_id", dealTextId)

      if (existingPayouts && existingPayouts.length > 0) {
        // Group payouts by csv_data_id (each event can have multiple payouts)
        const payoutsByEvent = new Map<string, any[]>()
        for (const payout of existingPayouts) {
          const key = payout.csv_data_id || "no_event"
          if (!payoutsByEvent.has(key)) {
            payoutsByEvent.set(key, [])
          }
          payoutsByEvent.get(key)!.push(payout)
        }

        // For each event, update payouts to match new participants
        for (const [csvDataId, payouts] of payoutsByEvent) {
          // Get one payout as template for shared fields
          const templatePayout = payouts[0]
          const netResidual = Number(templatePayout.net_residual) || 0

          // Track which payouts we've matched
          const matchedPayoutIds = new Set<string>()

          // Validate all participants have Airtable IDs before processing
          const invalidParticipants = newParticipants.filter(
            (p: any) => {
              const id = p.partner_airtable_id || p.agent_id || p.airtable_id || p.id
              return !id || (typeof id === 'string' && id.trim() === "")
            }
          )
          if (invalidParticipants.length > 0) {
            const names = invalidParticipants.map((p: any) => p.partner_name || p.name || "Unknown").join(", ")
            return NextResponse.json(
              { success: false, error: `Missing Airtable IDs for participants: ${names}` },
              { status: 400 }
            )
          }

          // For each new participant, find matching payout
          for (const participant of newParticipants) {
            const splitPct = participant.split_pct || 0
            const amount = (netResidual * splitPct) / 100
            const participantAirtableId =
              participant.partner_airtable_id ||
              participant.agent_id ||
              participant.airtable_id ||
              participant.id

            // First try to match by partner_airtable_id
            let existingPayout = participantAirtableId
              ? payouts.find((p) => p.partner_airtable_id === participantAirtableId && !matchedPayoutIds.has(p.id))
              : null

            // If no match by ID, match by split percentage (for fixing mismatched records)
            if (!existingPayout) {
              existingPayout = payouts.find(
                (p) => Math.abs(Number(p.partner_split_pct) - splitPct) < 0.01 && !matchedPayoutIds.has(p.id),
              )
            }

            if (existingPayout) {
              matchedPayoutIds.add(existingPayout.id)

              // Update existing payout with correct participant info
              await supabase
                .from("payouts")
                .update({
                  partner_name: participant.partner_name,
                  partner_role: participant.partner_role || participant.role,
                  partner_airtable_id: participantAirtableId,
                  partner_split_pct: splitPct,
                  partner_payout_amount: amount,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", existingPayout.id)
            } else if (csvDataId !== "no_event") {
              // Add new participant as a new payout - use TEXT deal_id for consistency
              await supabase.from("payouts").insert({
                csv_data_id: csvDataId,
                deal_id: dealTextId,
                mid: templatePayout.mid,
                merchant_name: templatePayout.merchant_name,
                payout_month: templatePayout.payout_month,
                // Use template payout_type first, fall back to current deal payout_type, then default to "residual"
                payout_type: templatePayout.payout_type || currentDeal.payout_type || "residual",
                volume: templatePayout.volume,
                fees: templatePayout.fees,
                adjustments: templatePayout.adjustments,
                chargebacks: templatePayout.chargebacks,
                net_residual: netResidual,
                partner_airtable_id: participantAirtableId,
                partner_role: participant.partner_role || participant.role,
                partner_name: participant.partner_name,
                partner_split_pct: splitPct,
                partner_payout_amount: amount,
                assignment_status: templatePayout.assignment_status || "confirmed",
                paid_status: "unpaid",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
            }
          }

          // Set unmatched payouts to 0% (they were removed from participants)
          for (const payout of payouts) {
            if (!matchedPayoutIds.has(payout.id)) {
              await supabase
                .from("payouts")
                .update({
                  partner_split_pct: 0,
                  partner_payout_amount: 0,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", payout.id)
            }
          }
        }

        console.log(`[deals API] Synced payouts for deal ${dealUUID} with ${newParticipants.length} participants`)
      }
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error("[deals API] Error updating deal:", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}

// Delete deal
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const column = isUUID(id) ? "id" : "deal_id"

    // First delete associated payouts
    const { error: payoutsError } = await supabase.from("payouts").delete().eq("deal_id", id)

    if (payoutsError) {
      console.error("Error deleting payouts:", payoutsError)
    }

    // DELETE csv_data records linked to this deal (not reset - full delete)
    const { error: csvError } = await supabase
      .from("csv_data")
      .delete()
      .eq("deal_id", id)

    if (csvError) {
      console.error("Error deleting csv_data:", csvError)
    }

    // Delete the deal
    const { error } = await supabase.from("deals").delete().eq(column, id)

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}
