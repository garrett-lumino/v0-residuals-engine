/**
 * Deal Participants Writer Service
 *
 * Handles dual-write operations to both the legacy participants_json column
 * and the new normalized deal_participants table.
 *
 * This service is controlled by the DUAL_WRITE_DEAL_PARTICIPANTS feature flag.
 * When disabled, it's a no-op. When enabled, it syncs the deal_participants table.
 */

import { createClient } from "@/lib/db/server"
import { FEATURE_FLAGS } from "@/lib/config/feature-flags"
import { getPartnerIdsByAirtableIds } from "./partner-lookup"
import type { DealParticipant } from "@/lib/types/database"

interface WriteDealParticipantsOptions {
  createdBy?: string
  effectiveFrom?: string // ISO date, defaults to today
}

interface WriteDealParticipantsResult {
  success: boolean
  written: number
  skipped: number
  error?: string
}

/**
 * Write participants to the deal_participants table
 *
 * This function syncs the normalized deal_participants table with the
 * participants array. It:
 * 1. Looks up partner UUIDs for all Airtable IDs
 * 2. Deletes existing participants for the deal
 * 3. Inserts new participant records
 *
 * @param dealId - UUID of the deal
 * @param participants - Array of participants (same format as participants_json)
 * @param options - Optional settings
 * @returns Result with counts of written/skipped participants
 */
export async function writeDealParticipants(
  dealId: string,
  participants: DealParticipant[],
  options: WriteDealParticipantsOptions = {}
): Promise<WriteDealParticipantsResult> {
  // If dual-write is disabled, return early with success
  if (!FEATURE_FLAGS.DUAL_WRITE_DEAL_PARTICIPANTS) {
    return { success: true, written: 0, skipped: 0 }
  }

  if (!dealId || !participants || participants.length === 0) {
    return { success: true, written: 0, skipped: 0 }
  }

  try {
    const supabase = await createClient()

    // 1. Get partner UUIDs for all Airtable IDs
    const airtableIds = participants
      .map((p) => p.partner_airtable_id)
      .filter((id): id is string => !!id)

    const partnerIdMap = await getPartnerIdsByAirtableIds(airtableIds)

    // 2. Delete existing participants for this deal (replace strategy)
    const { error: deleteError } = await supabase
      .from("deal_participants")
      .delete()
      .eq("deal_id", dealId)

    if (deleteError) {
      console.error("[dual-write] Failed to delete existing participants:", deleteError)
      return { success: false, written: 0, skipped: 0, error: deleteError.message }
    }

    // 3. Build records for participants that have valid partner mappings
    const effectiveFrom = options.effectiveFrom || new Date().toISOString().split("T")[0]

    const records = participants
      .filter((p) => p.partner_airtable_id && partnerIdMap.has(p.partner_airtable_id))
      .map((p) => ({
        deal_id: dealId,
        partner_id: partnerIdMap.get(p.partner_airtable_id!)!,
        split_pct: p.split_pct || 0,
        role: p.partner_role || "Partner",
        effective_from: effectiveFrom,
        effective_to: null,
        created_by: options.createdBy || null,
      }))

    const skipped = participants.length - records.length

    // 4. Insert new participants
    if (records.length > 0) {
      const { error: insertError } = await supabase.from("deal_participants").insert(records)

      if (insertError) {
        console.error("[dual-write] Failed to insert deal_participants:", insertError)
        return { success: false, written: 0, skipped, error: insertError.message }
      }
    }

    // Log any participants that couldn't be mapped (for debugging)
    if (skipped > 0) {
      const unmapped = participants.filter(
        (p) => !p.partner_airtable_id || !partnerIdMap.has(p.partner_airtable_id)
      )
      console.warn(
        "[dual-write] Participants without partner records:",
        unmapped.map((p) => p.partner_name || p.partner_airtable_id).join(", ")
      )
    }

    return { success: true, written: records.length, skipped }
  } catch (error: any) {
    console.error("[dual-write] Error writing deal participants:", error)
    return { success: false, written: 0, skipped: 0, error: error.message }
  }
}

/**
 * Delete all participants for a deal from the normalized table
 * Used when a deal is deleted
 */
export async function deleteDealParticipants(dealId: string): Promise<{ success: boolean; error?: string }> {
  if (!FEATURE_FLAGS.DUAL_WRITE_DEAL_PARTICIPANTS) {
    return { success: true }
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.from("deal_participants").delete().eq("deal_id", dealId)

    if (error) {
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

