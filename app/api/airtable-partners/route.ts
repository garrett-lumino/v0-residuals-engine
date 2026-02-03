import { type NextRequest, NextResponse } from "next/server"

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID
const PARTNERS_TABLE_ID = "tbl4Ea0fxLzlGpuUd" // Partners table

interface AirtableRecord {
  id: string
  fields: {
    "Partner Name"?: string
    Email?: string
    Role?: string
    "Default Split %"?: number
    Status?: string
    [key: string]: any
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      console.error("[airtable-partners] Missing Airtable credentials")
      return NextResponse.json({ error: "Airtable not configured" }, { status: 500 })
    }

    console.log("[airtable-partners] Fetching partners from Airtable...")

    // Fetch all partners from Airtable
    const allPartners: AirtableRecord[] = []
    let offset: string | undefined

    do {
      const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${PARTNERS_TABLE_ID}`)
      url.searchParams.set("pageSize", "100")
      if (offset) {
        url.searchParams.set("offset", offset)
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error("[airtable-partners] Airtable API error:", response.status, errorText)
        throw new Error(`Airtable API error: ${response.status}`)
      }

      const data = await response.json()
      allPartners.push(...(data.records || []))
      offset = data.offset

      console.log(`[airtable-partners] Fetched ${data.records?.length || 0} partners, offset: ${offset || "none"}`)
    } while (offset)

    // Transform to our Partner format
    // Use Airtable record ID as the id - this is what we'll store in payouts
    const partners = allPartners
      .filter((record) => record.fields["Partner Name"]) // Only include records with names
      .map((record) => ({
        id: record.id, // Airtable record ID (e.g., "recABC123")
        name: record.fields["Partner Name"] || "",
        email: record.fields["Email"] || "",
        role: record.fields["Role"] || "Partner",
        default_split_pct: record.fields["Default Split %"] || 0,
        status: record.fields["Status"] || "Active",
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    console.log(`[airtable-partners] Returning ${partners.length} partners`)

    return NextResponse.json({
      success: true,
      partners,
      source: "airtable_live",
      fetched_at: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error("[airtable-partners] Error:", error)
    return NextResponse.json(
      {
        error: error.message || "Failed to fetch partners",
        partners: [],
      },
      { status: 500 },
    )
  }
}
