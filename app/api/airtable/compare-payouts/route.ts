import { createServerClient } from "@/lib/db/server"
import { NextResponse } from "next/server"

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "appRygdwVIEtbUI1C"
const AIRTABLE_TABLE_ID = "tblWZlEw6pM9ytA1x"

/**
 * Payout with joined partner data from partners table
 * Uses the new normalized schema where partner info comes from JOIN
 */
interface PayoutWithPartner {
  id: string
  deal_id: string | null
  mid: string | null
  merchant_name: string | null
  payout_month: string | null
  payout_date: string | null
  partner_split_pct: number | null
  partner_payout_amount: number | null
  volume: number | null
  fees: number | null
  net_residual: number | null
  payout_type: string | null
  assignment_status: string | null
  paid_status: string | null
  paid_at: string | null
  is_legacy_import: boolean | null
  partner_id: string | null
  // Legacy fields (for backward compatibility during migration)
  partner_airtable_id?: string | null
  partner_name?: string | null
  partner_role?: string | null
  // Joined partner data from partners table
  partner: {
    external_id: string | null
    name: string
    role: string
  } | null
}

const cleanString = (val: any): string => {
  if (val === null || val === undefined) return ""
  return String(val)
    .trim()
    .replace(/[\r\n]+/g, " ")
}

/**
 * Format payout for Airtable comparison
 * Uses joined partner data when available, falls back to legacy columns
 */
const formatPayoutForAirtable = (payout: PayoutWithPartner) => {
  // Partner data: prefer joined partner table, fall back to legacy columns
  const partnerId = payout.partner?.external_id || payout.partner_airtable_id || ""
  const partnerName = payout.partner?.name || payout.partner_name || ""
  const partnerRole = payout.partner?.role || payout.partner_role || ""

  const fields: Record<string, any> = {
    "Payout ID": payout.id,
    "Deal ID": payout.deal_id || "",
    MID: String(payout.mid || ""),
    "Merchant Name": cleanString(payout.merchant_name),
    "Payout Month": payout.payout_month || "",
    "Payout Date": payout.payout_date || null,
    "Partner ID": partnerId,
    "Partner Name": cleanString(partnerName),
    "Partner Role": cleanString(partnerRole),
    "Split %": payout.partner_split_pct || 0,
    "Payout Amount": payout.partner_payout_amount || 0,
    Volume: payout.volume || 0,
    Fees: payout.fees || 0,
    "Net Residual": payout.net_residual || 0,
    "Payout Type": payout.payout_type || "residual",
    Status: cleanString(payout.assignment_status),
    "Paid Status": payout.paid_status || "unpaid",
    "Is Legacy": payout.is_legacy_import ? "Yes" : "No",
  }

  if (payout.paid_at) {
    fields["Paid At"] = payout.paid_at
  }

  return fields
}

// Compare two values, handling numbers and strings
const valuesMatch = (airtableVal: any, supabaseVal: any): boolean => {
  // Handle nulls/undefined
  if (airtableVal === null || airtableVal === undefined) airtableVal = ""
  if (supabaseVal === null || supabaseVal === undefined) supabaseVal = ""

  // Handle numbers
  if (typeof supabaseVal === "number") {
    return Number(airtableVal) === supabaseVal
  }

  return String(airtableVal) === String(supabaseVal)
}

// Fields to compare for changes
const COMPARE_FIELDS = [
  "Paid Status",
  "Paid At",
  "Status",
  "Split %",
  "Payout Amount",
  "Partner Role",
  "Partner Name",
  "Partner ID",
  "Merchant Name",
  "MID",
  "Payout Month",
  "Volume",
  "Fees",
  "Net Residual",
]

export async function POST(request: Request) {
  if (!AIRTABLE_API_KEY) {
    return NextResponse.json({ error: "Missing AIRTABLE_API_KEY environment variable" }, { status: 500 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const { month } = body

    const supabase = await createServerClient()

    // Supabase has a default limit of 1000, so we need to paginate to get ALL payouts
    // Uses the new normalized schema - partner info comes from JOIN instead of denormalized columns
    const allPayouts: PayoutWithPartner[] = []
    const PAGE_SIZE = 1000
    let from = 0

    while (true) {
      let query = supabase
        .from("payouts")
        .select(`
          *,
          partner:partners!partner_id (
            external_id,
            name,
            role
          )
        `)
        .order("created_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1)

      if (month) {
        query = query.eq("payout_month", month)
      }

      const { data: pageData, error } = await query as { data: PayoutWithPartner[] | null; error: any }

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      if (!pageData || pageData.length === 0) {
        break
      }

      allPayouts.push(...pageData)

      // If we got less than PAGE_SIZE, we've reached the end
      if (pageData.length < PAGE_SIZE) {
        break
      }

      from += PAGE_SIZE
    }

    if (allPayouts.length === 0) {
      return NextResponse.json({
        success: true,
        newRecords: [],
        changedRecords: [],
        unchangedCount: 0,
        totalSupabase: 0,
        totalAirtable: 0,
      })
    }

    // Step 2: Fetch existing Airtable records (track ALL to detect duplicates)
    const existingRecords: Map<string, { id: string; fields: any }[]> = new Map()
    let offset: string | undefined

    do {
      const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`)
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
        return NextResponse.json(
          { error: `Failed to fetch from Airtable: ${response.status} - ${errorText}` },
          { status: 500 },
        )
      }

      const data = await response.json()

      for (const record of data.records || []) {
        const payoutId = record.fields["Payout ID"]
        if (payoutId) {
          // Track ALL records for each payout ID (to detect duplicates)
          const existing = existingRecords.get(payoutId) || []
          existing.push(record)
          existingRecords.set(payoutId, existing)
        }
      }
      offset = data.offset
    } while (offset)

    // Count duplicates
    let duplicateCount = 0
    const duplicateRecordIds: string[] = []
    for (const [, records] of existingRecords.entries()) {
      if (records.length > 1) {
        duplicateCount += records.length - 1
        // Mark all but the first as duplicates
        for (let i = 1; i < records.length; i++) {
          duplicateRecordIds.push(records[i].id)
        }
      }
    }

    // Step 3: Compare and categorize
    const newRecords: any[] = []
    const changedRecords: any[] = []
    let unchangedCount = 0

    // Track which Airtable payout IDs we've matched
    const matchedPayoutIds = new Set<string>()

    for (const payout of allPayouts) {
      const airtableData = formatPayoutForAirtable(payout)
      const existingRecordsList = existingRecords.get(payout.id)

      // Get partner name from joined data or legacy column
      const partnerName = payout.partner?.name || payout.partner_name || ""

      if (!existingRecordsList || existingRecordsList.length === 0) {
        // New record - doesn't exist in Airtable
        newRecords.push({
          payoutId: payout.id,
          mid: payout.mid,
          merchantName: payout.merchant_name,
          partnerName,
          payoutMonth: payout.payout_month,
          payoutAmount: payout.partner_payout_amount,
          status: payout.assignment_status,
          paidStatus: payout.paid_status,
          fields: airtableData,
        })
      } else {
        // Mark this payout ID as matched
        matchedPayoutIds.add(payout.id)

        // Use the FIRST record (primary), extras are duplicates
        const primaryRecord = existingRecordsList[0]
        const existing = primaryRecord.fields
        const changes: { field: string; oldValue: any; newValue: any }[] = []

        for (const field of COMPARE_FIELDS) {
          if (!valuesMatch(existing[field], airtableData[field])) {
            changes.push({
              field,
              oldValue: existing[field],
              newValue: airtableData[field],
            })
          }
        }

        if (changes.length > 0) {
          changedRecords.push({
            payoutId: payout.id,
            airtableRecordId: primaryRecord.id,
            mid: payout.mid,
            merchantName: payout.merchant_name,
            partnerName,
            payoutMonth: payout.payout_month,
            changes,
            fields: airtableData,
          })
        } else {
          unchangedCount++
        }
      }
    }

    // Step 4: Find ORPHANED records (in Airtable but NOT in Supabase - need to DELETE)
    const orphanedRecords: any[] = []
    for (const [payoutId, records] of existingRecords.entries()) {
      if (!matchedPayoutIds.has(payoutId)) {
        // This Airtable record has no matching Supabase record - it's orphaned!
        for (const record of records) {
          orphanedRecords.push({
            airtableRecordId: record.id,
            payoutId: payoutId,
            mid: record.fields["MID"] || "",
            merchantName: record.fields["Merchant Name"] || "",
            partnerName: record.fields["Partner Name"] || "",
            payoutMonth: record.fields["Payout Month"] || "",
            payoutAmount: record.fields["Payout Amount"] || 0,
          })
        }
      }
    }

    return NextResponse.json({
      success: true,
      newRecords,
      changedRecords,
      orphanedRecords,
      unchangedCount,
      duplicateCount,
      duplicateRecordIds: duplicateRecordIds.length > 0 ? duplicateRecordIds : undefined,
      totalSupabase: allPayouts.length,
      totalAirtable: existingRecords.size,
      orphanedCount: orphanedRecords.length,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to compare payouts" }, { status: 500 })
  }
}
