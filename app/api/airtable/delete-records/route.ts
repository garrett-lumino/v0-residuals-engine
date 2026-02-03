import { NextResponse } from "next/server"

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "appRygdwVIEtbUI1C"
const AIRTABLE_TABLE_ID = "tblWZlEw6pM9ytA1x"

export async function POST(request: Request) {
  if (!AIRTABLE_API_KEY) {
    return NextResponse.json({ error: "Missing AIRTABLE_API_KEY environment variable" }, { status: 500 })
  }

  try {
    const body = await request.json()
    const { recordIds } = body

    if (!Array.isArray(recordIds) || recordIds.length === 0) {
      return NextResponse.json({ error: "No record IDs provided" }, { status: 400 })
    }

    console.log(`[delete-records] Deleting ${recordIds.length} records from Airtable`)

    // Airtable allows max 10 records per delete request
    const BATCH_SIZE = 10
    let deleted = 0
    const errors: string[] = []

    for (let i = 0; i < recordIds.length; i += BATCH_SIZE) {
      const batch = recordIds.slice(i, i + BATCH_SIZE)

      // Build URL with multiple records[] params
      const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`)
      batch.forEach((id) => url.searchParams.append("records[]", id))

      const response = await fetch(url.toString(), {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`[delete-records] Airtable error: ${response.status} - ${errorText}`)
        errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${response.status}`)
      } else {
        const data = await response.json()
        deleted += data.records?.length || batch.length
      }

      // Small delay to avoid rate limits
      if (i + BATCH_SIZE < recordIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    }

    console.log(`[delete-records] Deleted ${deleted} records, ${errors.length} errors`)

    return NextResponse.json({
      success: errors.length === 0,
      deleted,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error: any) {
    console.error("[delete-records] Error:", error)
    return NextResponse.json({ error: error.message || "Failed to delete records" }, { status: 500 })
  }
}

