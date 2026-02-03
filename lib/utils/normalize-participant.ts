/**
 * Normalize participant data to use consistent field naming
 * Handles both old format (partner_id, partner_name) and new format (partner_airtable_id, etc.)
 */

export interface NormalizedParticipant {
  partner_airtable_id: string
  partner_name: string
  partner_role: string
  split_pct: number
  name?: string
  role?: string
}

export interface RawParticipant {
  partner_id?: string
  partner_airtable_id?: string
  partner_name?: string
  name?: string
  partner_role?: string
  role?: string
  split_pct?: number
  split?: number
}

/**
 * Normalizes an array of participants to use consistent field naming
 * Maps various input formats to a standardized structure
 */
export function normalizeParticipants(rawParticipants: RawParticipant[]): NormalizedParticipant[] {
  return rawParticipants.map((p) => normalizeParticipant(p))
}

/**
 * Normalizes partner role based on partner name
 * Ensures consistent role labeling for known partners
 */
function normalizePartnerRole(partnerName: string, currentRole: string): string {
  // Lumino Income Fund LP should always be "Fund I"
  if (partnerName.toLowerCase().includes("lumino income fund")) {
    return "Fund I"
  }
  // Lumino (Company) should always be "Company"
  if (partnerName.toLowerCase().includes("lumino (company)") || partnerName.toLowerCase() === "lumino") {
    return "Company"
  }
  return currentRole || "Partner"
}

/**
 * Normalizes a single participant to use consistent field naming
 */
export function normalizeParticipant(p: RawParticipant | Record<string, unknown>): NormalizedParticipant {
  const partnerName = (p.partner_name as string) || (p.name as string) || ""
  const rawRole = (p.partner_role as string) || (p.role as string) || "Partner"
  const normalizedRole = normalizePartnerRole(partnerName, rawRole)

  return {
    partner_airtable_id: (p.partner_airtable_id as string) || (p.partner_id as string) || "",
    partner_name: partnerName,
    partner_role: normalizedRole,
    split_pct: (p.split_pct as number) ?? (p.split as number) ?? 0,
    // Keep legacy fields for backwards compatibility
    name: partnerName,
    role: normalizedRole,
  }
}

