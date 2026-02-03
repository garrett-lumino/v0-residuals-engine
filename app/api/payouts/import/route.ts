import { createServerClient } from "@/lib/db/server"
import { NextResponse } from "next/server"
import { syncPayoutsToAirtable } from "@/lib/services/airtable-sync"

export async function POST(request: Request) {
  try {
    const { payouts } = await request.json()

    if (!Array.isArray(payouts) || payouts.length === 0) {
      return NextResponse.json({ error: "No payouts provided" }, { status: 400 })
    }

    const supabase = await createServerClient()

    const cleanedPayouts = payouts.map((payout) => {
      const cleaned = { ...payout }

      // Convert empty strings to null for date fields
      if (cleaned.paid_at === "") cleaned.paid_at = null
      if (cleaned.payout_date === "") cleaned.payout_date = null

      // Set csv_data_id to null for legacy imports
      cleaned.csv_data_id = null

      // Mark as legacy import
      cleaned.is_legacy_import = true

      // Remove deprecated deal_plan field
      delete cleaned.deal_plan

      return cleaned
    })

    // Insert payouts in batches of 100
    const batchSize = 100
    let imported = 0
    let errors = 0
    const importedIds: string[] = []

    for (let i = 0; i < cleanedPayouts.length; i += batchSize) {
      const batch = cleanedPayouts.slice(i, i + batchSize)

      const { data, error } = await supabase
        .from("payouts")
        .upsert(batch, { onConflict: "id" })
        .select("id")

      if (error) {
        console.error("[v0] Batch import error:", error)
        errors += batch.length
      } else {
        imported += batch.length
        if (data) {
          importedIds.push(...data.map((p) => p.id))
        }
      }
    }

    // Sync imported payouts to Airtable
    let airtableResult = { synced: 0, error: undefined as string | undefined }
    if (importedIds.length > 0) {
      airtableResult = await syncPayoutsToAirtable(importedIds)
      if (airtableResult.error) {
        console.error("[v0] Airtable sync failed:", airtableResult.error)
      }
    }

    return NextResponse.json({
      success: true,
      imported,
      errors,
      total: payouts.length,
      airtable_synced: airtableResult.synced,
      airtable_error: airtableResult.error ? "Sync partially failed" : undefined,
    })
  } catch (error) {
    console.error("[v0] Import payouts error:", error)
    return NextResponse.json({ error: "Failed to import payouts" }, { status: 500 })
  }
}
