// Script to reconstruct deals from imported payouts
// Run this with: node --loader ts-node/esm scripts/003_reconstruct_deals_from_payouts.ts

import { createClient } from "@supabase/supabase-js"

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function reconstructDeals() {
  console.log("[v0] Starting deal reconstruction from payouts...")

  // Fetch all payouts grouped by deal_id and mid
  const { data: payouts, error } = await supabase.from("payouts").select("*").eq("is_legacy_import", true)

  if (error) {
    console.error("[v0] Error fetching payouts:", error)
    return
  }

  console.log(`[v0] Found ${payouts.length} legacy payouts`)

  // Group payouts by deal_id and mid
  const dealGroups = new Map<string, typeof payouts>()

  for (const payout of payouts) {
    const key = `${payout.deal_id}|${payout.mid}`
    if (!dealGroups.has(key)) {
      dealGroups.set(key, [])
    }
    dealGroups.get(key)!.push(payout)
  }

  console.log(`[v0] Grouped into ${dealGroups.size} unique deals`)

  // Create deal records
  const dealsToInsert = []

  for (const [key, groupPayouts] of dealGroups) {
    const [deal_id, mid] = key.split("|")
    const firstPayout = groupPayouts[0]

    // Build participants_json from all payouts in this deal
    const participants = groupPayouts.map((p) => ({
      partner_airtable_id: p.partner_airtable_id,
      partner_role: p.partner_role,
      split_pct: Number.parseFloat(p.partner_split_pct || "0"),
    }))

    dealsToInsert.push({
      deal_id,
      mid,
      payout_type: firstPayout.payout_type || "residual",
      participants_json: participants,
      effective_date: firstPayout.payout_date,
      assigned_at: firstPayout.created_at,
      is_legacy_import: true,
      created_at: firstPayout.created_at,
      updated_at: firstPayout.updated_at,
    })
  }

  // Insert deals in batches
  const batchSize = 100
  let inserted = 0

  for (let i = 0; i < dealsToInsert.length; i += batchSize) {
    const batch = dealsToInsert.slice(i, i + batchSize)

    const { error: insertError } = await supabase
      .from("deals")
      .upsert(batch, { onConflict: "mid,payout_type", ignoreDuplicates: false })

    if (insertError) {
      console.error(`[v0] Error inserting batch ${i / batchSize + 1}:`, insertError)
    } else {
      inserted += batch.length
      console.log(`[v0] Inserted ${inserted}/${dealsToInsert.length} deals`)
    }
  }

  console.log("[v0] Deal reconstruction complete!")
  console.log(`[v0] Total deals created: ${inserted}`)
}

reconstructDeals().catch(console.error)
