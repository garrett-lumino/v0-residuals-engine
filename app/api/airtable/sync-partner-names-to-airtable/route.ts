import { createServerClient } from "@/lib/db/server"
import { NextResponse } from "next/server"

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID

/**
 * Payout with joined partner data from partners table
 */
interface PayoutWithPartner {
  id: string
  partner_name?: string | null
  partner_airtable_id?: string | null
  partner: {
    external_id: string | null
    name: string
  } | null
}

export async function POST() {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    return NextResponse.json({ error: "Missing Airtable API key or Base ID in environment variables" }, { status: 500 })
  }

  try {
    const supabase = await createServerClient()

    let allPayouts: Array<{ id: string; partner_name: string | null }> = []
    const pageSize = 1000
    let page = 0
    let hasMore = true

    while (hasMore) {
      // Query with JOIN to partners table for partner names
      const { data: payouts, error: payoutsError } = await supabase
        .from("payouts")
        .select(`
          id,
          partner_name,
          partner_airtable_id,
          partner:partners!partner_id (
            external_id,
            name
          )
        `)
        .range(page * pageSize, (page + 1) * pageSize - 1) as { data: PayoutWithPartner[] | null; error: any }

      if (payoutsError) {
        return NextResponse.json({ error: payoutsError.message }, { status: 500 })
      }

      if (payouts && payouts.length > 0) {
        const processedPayouts = payouts.map((p) => {
          // Get partner ID from joined data or legacy column
          const partnerId = p.partner?.external_id || p.partner_airtable_id
          // Get partner name from joined data or legacy column
          const name = p.partner?.name || p.partner_name

          return {
            id: p.id,
            partner_name: partnerId === "lumino-company" ? "Lumino (Company)" : name,
          }
        })
        allPayouts = allPayouts.concat(processedPayouts)
        page++
        hasMore = payouts.length === pageSize
      } else {
        hasMore = false
      }
    }

    // Filter to only payouts with names
    const payoutsWithNames = allPayouts.filter((p) => p.partner_name && p.partner_name !== "")

    if (payoutsWithNames.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No payouts with partner names to sync",
        updated: 0,
      })
    }

    console.log(
      `[sync-to-airtable] Found ${payoutsWithNames.length} payouts with partner_name (total: ${allPayouts.length})`,
    )

    // Step 2: Fetch Airtable records to find matching Payout IDs
    const tableId = "All Payouts"
    const encodedTableId = encodeURIComponent(tableId)

    let allRecords: Array<{ id: string; fields: { "Payout ID"?: string; "Partner Name"?: string } }> = []
    let offset: string | undefined

    // Fetch all Airtable records with pagination
    do {
      const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodedTableId}`)
      url.searchParams.set("fields[]", "Payout ID")
      url.searchParams.set("pageSize", "100")
      if (offset) {
        url.searchParams.set("offset", offset)
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error("[sync-to-airtable] Airtable fetch error:", errorText)
        return NextResponse.json({ error: `Failed to fetch from Airtable: ${response.status}` }, { status: 500 })
      }

      const data = await response.json()
      allRecords = allRecords.concat(data.records || [])
      offset = data.offset

      console.log(`[sync-to-airtable] Fetched ${allRecords.length} Airtable records so far...`)
    } while (offset)

    console.log(`[sync-to-airtable] Total Airtable records: ${allRecords.length}`)

    // Step 3: Create a map of payout_id -> partner_name from Supabase
    const payoutNameMap = new Map<string, string>()
    for (const payout of payoutsWithNames) {
      if (payout.partner_name) {
        payoutNameMap.set(payout.id, payout.partner_name)
      }
    }

    // Step 4: Find Airtable records that need updating
    const recordsToUpdate: Array<{ id: string; fields: { "Partner Name": string } }> = []

    for (const record of allRecords) {
      const payoutId = record.fields["Payout ID"]
      if (payoutId && payoutNameMap.has(payoutId)) {
        recordsToUpdate.push({
          id: record.id,
          fields: {
            "Partner Name": payoutNameMap.get(payoutId)!,
          },
        })
      }
    }

    console.log(`[sync-to-airtable] Records to update: ${recordsToUpdate.length}`)

    if (recordsToUpdate.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No matching Airtable records found to update",
        updated: 0,
        totalPayouts: allPayouts.length,
        totalAirtableRecords: allRecords.length,
      })
    }

    // Step 5: Update Airtable records in batches of 10
    let updatedCount = 0
    const batchSize = 10

    for (let i = 0; i < recordsToUpdate.length; i += batchSize) {
      const batch = recordsToUpdate.slice(i, i + batchSize)

      const updateResponse = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodedTableId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ records: batch }),
      })

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text()
        console.error(`[sync-to-airtable] Batch update error:`, errorText)
      } else {
        updatedCount += batch.length
        console.log(`[sync-to-airtable] Updated batch ${Math.floor(i / batchSize) + 1}, total: ${updatedCount}`)
      }

      // Rate limiting - Airtable allows 5 requests per second
      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    return NextResponse.json({
      success: true,
      message: `Successfully synced ${updatedCount} partner names to Airtable`,
      updated: updatedCount,
      totalPayouts: allPayouts.length,
      totalAirtableRecords: allRecords.length,
      matched: recordsToUpdate.length,
    })
  } catch (error: any) {
    console.error("[sync-to-airtable] Error:", error)
    return NextResponse.json({ error: error.message || "Failed to sync partner names to Airtable" }, { status: 500 })
  }
}
