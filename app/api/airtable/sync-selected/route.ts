import { NextResponse } from "next/server"

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "appRygdwVIEtbUI1C"
const AIRTABLE_TABLE_ID = "tblWZlEw6pM9ytA1x"

export async function POST(request: Request) {
  if (!AIRTABLE_API_KEY) {
    return NextResponse.json({ error: "Missing AIRTABLE_API_KEY environment variable" }, { status: 500 })
  }

  try {
    const { newRecords, changedRecords } = await request.json()

    console.log("[v0] sync-selected called with:", {
      newRecordsCount: newRecords?.length || 0,
      changedRecordsCount: changedRecords?.length || 0,
    })

    const batchSize = 10
    let createdCount = 0
    let updatedCount = 0
    const errors: string[] = []

    // Create new records
    if (newRecords && newRecords.length > 0) {
      console.log("[v0] First new record:", JSON.stringify(newRecords[0], null, 2))

      const recordsToCreate = newRecords.map((r: any) => ({ fields: r.fields }))

      for (let i = 0; i < recordsToCreate.length; i += batchSize) {
        const batch = recordsToCreate.slice(i, i + batchSize)

        console.log("[v0] Creating batch:", JSON.stringify(batch, null, 2))

        const createResponse = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${AIRTABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ records: batch }),
        })

        const responseText = await createResponse.text()
        console.log("[v0] Create response:", createResponse.status, responseText)

        if (createResponse.ok) {
          createdCount += batch.length
        } else {
          const errMsg = `Create batch ${Math.floor(i / batchSize)}: ${responseText}`
          console.error("[v0] Create error:", errMsg)
          errors.push(errMsg)
        }

        await new Promise((resolve) => setTimeout(resolve, 220))
      }
    }

    // Update changed records
    if (changedRecords && changedRecords.length > 0) {
      console.log("[v0] First changed record:", JSON.stringify(changedRecords[0], null, 2))

      const validRecords = changedRecords.filter((r: any) => r.airtableRecordId)
      const invalidCount = changedRecords.length - validRecords.length

      if (invalidCount > 0) {
        console.log("[v0] WARNING: Skipping", invalidCount, "records without airtableRecordId")
        errors.push(`Skipped ${invalidCount} records missing Airtable record ID`)
      }

      const recordsToUpdate = validRecords.map((r: any) => ({
        id: r.airtableRecordId,
        fields: r.fields,
      }))

      console.log("[v0] Records to update count:", recordsToUpdate.length)
      if (recordsToUpdate.length > 0) {
        console.log("[v0] First record to update:", JSON.stringify(recordsToUpdate[0], null, 2))
      }

      for (let i = 0; i < recordsToUpdate.length; i += batchSize) {
        const batch = recordsToUpdate.slice(i, i + batchSize)

        console.log("[v0] Updating batch", Math.floor(i / batchSize) + 1, "with", batch.length, "records")

        const updateResponse = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${AIRTABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ records: batch }),
        })

        const responseText = await updateResponse.text()
        console.log("[v0] Update response:", updateResponse.status, responseText.substring(0, 200))

        if (updateResponse.ok) {
          updatedCount += batch.length
        } else {
          const errMsg = `Update batch ${Math.floor(i / batchSize)}: ${responseText}`
          console.error("[v0] Update error:", errMsg)
          errors.push(errMsg)
        }

        await new Promise((resolve) => setTimeout(resolve, 220))
      }
    }

    console.log("[v0] Sync complete:", { createdCount, updatedCount, errorCount: errors.length })

    return NextResponse.json({
      success: errors.length === 0,
      created: createdCount,
      updated: updatedCount,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error: any) {
    console.error("[v0] Sync failed:", error)
    return NextResponse.json({ error: error.message || "Failed to sync selected records" }, { status: 500 })
  }
}
