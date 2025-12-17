import { NextResponse } from "next/server"
import { createServerClient } from "@/lib/db/server"

export async function POST() {
  try {
    const supabase = await createServerClient()

    console.log("[v0] Starting deal reconstruction from payouts...")

    // Fetch all legacy payouts
    const { data: payouts, error } = await supabase.from("payouts").select("*").eq("is_legacy_import", true)

    if (error) {
      console.error("[v0] Error fetching payouts:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log(`[v0] Found ${payouts.length} legacy payouts`)

    const dealGroups = new Map<string, typeof payouts>()

    for (const payout of payouts) {
      const mid = payout.mid
      if (!dealGroups.has(mid)) {
        dealGroups.set(mid, [])
      }
      dealGroups.get(mid)!.push(payout)
    }

    console.log(`[v0] Grouped into ${dealGroups.size} unique merchants (by mid)`)

    // Create deal records - one per unique mid
    const dealsToInsert = []

    for (const [mid, groupPayouts] of dealGroups) {
      const firstPayout = groupPayouts[0]

      const participantMap = new Map<string, any>()

      for (const p of groupPayouts) {
        if (p.partner_airtable_id && !participantMap.has(p.partner_airtable_id)) {
          participantMap.set(p.partner_airtable_id, {
            partner_airtable_id: p.partner_airtable_id,
            partner_role: p.partner_role,
            split_pct: Number.parseFloat(p.partner_split_pct || "0"),
          })
        }
      }

      const participants = Array.from(participantMap.values())

      dealsToInsert.push({
        deal_id: firstPayout.deal_id, // Use the first deal_id found for this merchant
        mid,
        payout_type: firstPayout.payout_type || "residual",
        participants_json: participants,
        effective_date: firstPayout.payout_date,
        assigned_at: firstPayout.created_at,
        created_at: firstPayout.created_at,
        updated_at: firstPayout.updated_at,
      })
    }

    console.log(`[v0] Prepared ${dealsToInsert.length} deals to insert`)

    // Insert deals in batches
    const batchSize = 50
    let inserted = 0

    for (let i = 0; i < dealsToInsert.length; i += batchSize) {
      const batch = dealsToInsert.slice(i, i + batchSize)

      const { error: insertError } = await supabase
        .from("deals")
        .upsert(batch, { onConflict: "mid,payout_type", ignoreDuplicates: false })

      if (insertError) {
        console.error(`[v0] Error inserting batch ${i / batchSize + 1}:`, insertError.message)
        return NextResponse.json({ error: insertError.message }, { status: 500 })
      }

      inserted += batch.length
      console.log(`[v0] Inserted ${inserted}/${dealsToInsert.length} deals`)
    }

    console.log("[v0] Deal reconstruction complete!")

    return NextResponse.json({
      success: true,
      payoutsProcessed: payouts.length,
      dealsCreated: inserted,
    })
  } catch (error) {
    console.error("[v0] Reconstruction error:", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
  }
}
