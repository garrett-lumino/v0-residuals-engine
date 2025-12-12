import { createServerClient } from "@/lib/db/server"
import { NextResponse } from "next/server"

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID
const PARTNERS_TABLE_ID = "tbl4Ea0fxLzlGpuUd"

interface AirtablePartner {
  id: string
  name: string
}

async function fetchAirtablePartners(): Promise<Map<string, string>> {
  const nameToIdMap = new Map<string, string>()
  
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    throw new Error("Airtable credentials not configured")
  }

  let offset: string | undefined
  do {
    const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${PARTNERS_TABLE_ID}`)
    url.searchParams.set("pageSize", "100")
    if (offset) url.searchParams.set("offset", offset)

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
      cache: "no-store",
    })

    if (!response.ok) throw new Error(`Airtable API error: ${response.status}`)

    const data = await response.json()
    for (const record of data.records || []) {
      const name = record.fields["Partner Name"]
      if (name) {
        // Store both exact match and lowercase for fuzzy matching
        nameToIdMap.set(name, record.id)
        nameToIdMap.set(name.toLowerCase().trim(), record.id)
      }
    }
    offset = data.offset
  } while (offset)

  // Add known static mappings
  nameToIdMap.set("lumino (company)", "lumino-company")
  nameToIdMap.set("Lumino (Company)", "lumino-company")

  return nameToIdMap
}

export async function POST() {
  try {
    const supabase = await createServerClient()
    const partnerMap = await fetchAirtablePartners()

    console.log(`[fix-missing-partner-ids] Loaded ${partnerMap.size / 2} partners from Airtable`)

    // Fetch all deals
    const { data: deals, error: dealsError } = await supabase
      .from("deals")
      .select("id, mid, participants_json")
      .not("participants_json", "is", null)

    if (dealsError) throw dealsError

    let dealsFixed = 0
    let participantsFixed = 0
    const unfixable: { mid: string; name: string }[] = []

    for (const deal of deals || []) {
      const participants = deal.participants_json as any[]
      let needsUpdate = false
      
      const fixedParticipants = participants.map((p) => {
        const hasValidId = p.partner_airtable_id && p.partner_airtable_id !== ""
        if (hasValidId) return p

        const name = p.partner_name || p.name || ""
        const airtableId = partnerMap.get(name) || partnerMap.get(name.toLowerCase().trim())

        if (airtableId) {
          needsUpdate = true
          participantsFixed++
          return {
            ...p,
            partner_airtable_id: airtableId,
            agent_id: airtableId,
            partner_id: airtableId,
          }
        } else {
          unfixable.push({ mid: deal.mid, name })
          return p
        }
      })

      if (needsUpdate) {
        const { error: updateError } = await supabase
          .from("deals")
          .update({ participants_json: fixedParticipants, updated_at: new Date().toISOString() })
          .eq("id", deal.id)

        if (!updateError) dealsFixed++
      }
    }

    // Also fix payouts with null partner_airtable_id
    const { data: badPayouts } = await supabase
      .from("payouts")
      .select("id, partner_name, partner_airtable_id")
      .or("partner_airtable_id.is.null,partner_airtable_id.eq.")

    let payoutsFixed = 0
    for (const payout of badPayouts || []) {
      const airtableId = partnerMap.get(payout.partner_name) || partnerMap.get(payout.partner_name?.toLowerCase().trim())
      if (airtableId) {
        await supabase
          .from("payouts")
          .update({ partner_airtable_id: airtableId })
          .eq("id", payout.id)
        payoutsFixed++
      }
    }

    return NextResponse.json({
      success: true,
      dealsFixed,
      participantsFixed,
      payoutsFixed,
      unfixable: unfixable.slice(0, 20), // First 20 unfixable
      unfixableCount: unfixable.length,
    })
  } catch (error: any) {
    console.error("[fix-missing-partner-ids] Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

