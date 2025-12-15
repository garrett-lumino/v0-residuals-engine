import Papa from "papaparse"

export interface ParsedCsvRow {
  mid: string
  merchant_name: string
  volume: number
  fees: number
  date: Date
  payout_month: string
  row_hash: string
  raw_data: Record<string, any>
}

export interface CsvParseResult {
  rows: ParsedCsvRow[]
  errors: string[]
}

// Maps CSV headers to internal field names
const HEADER_MAPPING: Record<string, string> = {
  "merchant id": "mid",
  mid: "mid",
  "merchant name": "merchant_name",
  name: "merchant_name",
  volume: "volume",
  amount: "volume",
  payouts: "fees",
  fees: "fees",
  commission: "fees",
  date: "date",
  "transaction date": "date",
  "processing month": "payout_month",
  "payout month": "payout_month",
  month: "payout_month",
}

export interface CsvParseOptions {
  payoutMonth?: string // Format: "YYYY-MM" - overrides any payout_month in CSV
}

async function generateHash(input: string): Promise<string> {
  try {
    // Try using Web Crypto API (works in browser and edge runtime)
    const encoder = new TextEncoder()
    const data = encoder.encode(input)
    const hashBuffer = await crypto.subtle.digest("SHA-256", data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
  } catch {
    // Fallback to simple string hash
    let hash = 0
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, "0")
  }
}

export async function parseCsvFile(fileContent: string, options?: CsvParseOptions): Promise<CsvParseResult> {
  return new Promise((resolve) => {
    Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => {
        const normalized = header.toLowerCase().trim()
        return HEADER_MAPPING[normalized] || normalized
      },
      complete: async (results) => {
        const rows: ParsedCsvRow[] = []
        const errors: string[] = [...results.errors.map((e) => `Line ${e.row}: ${e.message}`)]

        for (let index = 0; index < results.data.length; index++) {
          const row = results.data[index] as any
          try {
            if (!row.mid) {
              // Skip rows without MID (might be empty or footer totals)
              continue
            }

            const volume = parseCurrency(row.volume || "0")
            const fees = parseCurrency(row.fees || "0")
            const dateStr = row.date || new Date().toISOString()
            const date = new Date(dateStr)

            if (isNaN(date.getTime())) {
              errors.push(`Row ${index + 2}: Invalid date format "${row.date}"`)
              continue
            }

            // IMPORTANT: Always preserve MID as a string exactly as it appears in CSV
            // Never convert to number as this strips leading zeros
            const midString = String(row.mid).trim()

            const merchantName = row.merchant_name || `Merchant ${midString}`

            const payoutMonth = options?.payoutMonth || row.payout_month || new Date().toISOString().slice(0, 7)

            // Generate hash for duplicate detection - use the midString that will be stored
            const hashInput = `${midString}|${payoutMonth}|${volume}|${fees}`
            const row_hash = await generateHash(hashInput)

            rows.push({
              mid: midString,
              merchant_name: merchantName,
              volume,
              fees,
              date,
              payout_month: payoutMonth,
              row_hash,
              raw_data: row,
            })
          } catch (err) {
            errors.push(`Row ${index + 2}: ${err instanceof Error ? err.message : "Unknown error"}`)
          }
        }

        resolve({ rows, errors })
      },
      error: (err) => {
        resolve({ rows: [], errors: [err.message] })
      },
    })
  })
}

function parseCurrency(value: string | number): number {
  if (typeof value === "number") return value
  // Remove currency symbols and commas, then parse
  const clean = value.replace(/[$,]/g, "").trim()
  const num = Number.parseFloat(clean)
  return isNaN(num) ? 0 : num
}
