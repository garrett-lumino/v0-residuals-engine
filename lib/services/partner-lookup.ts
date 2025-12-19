/**
 * Partner Lookup Service
 *
 * Provides efficient partner ID lookups with in-memory caching.
 * Used to translate Airtable record IDs to internal UUIDs during the migration period.
 *
 * Cache Strategy:
 * - Stale after 5 minutes (configurable via CACHE_TTL_MS)
 * - Cleared on stale check, not TTL expiration per entry
 * - Bulk lookups preferred for batch operations
 */

import { createClient } from "@/lib/db/server"
import type { Partner } from "@/lib/types/database"

// In-memory cache for partner lookups
const partnerCache = new Map<string, Partner>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
let lastCacheClear = Date.now()

/**
 * Clear cache if TTL has expired
 */
function clearStaleCache(): void {
  if (Date.now() - lastCacheClear > CACHE_TTL_MS) {
    partnerCache.clear()
    lastCacheClear = Date.now()
  }
}

/**
 * Look up partner UUID by Airtable record ID
 *
 * @param airtableId - Airtable record ID (e.g., "recABC123")
 * @returns Partner UUID or null if not found
 */
export async function getPartnerIdByAirtableId(airtableId: string): Promise<string | null> {
  if (!airtableId) return null

  clearStaleCache()

  // Check cache first
  const cached = partnerCache.get(airtableId)
  if (cached) return cached.id

  // Query database
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("partners")
    .select("*")
    .eq("external_id", airtableId)
    .eq("external_source", "airtable")
    .single()

  if (error || !data) return null

  // Cache and return
  partnerCache.set(airtableId, data as Partner)
  return data.id
}

/**
 * Look up full partner record by Airtable ID
 *
 * @param airtableId - Airtable record ID
 * @returns Full Partner object or null
 */
export async function getPartnerByAirtableId(airtableId: string): Promise<Partner | null> {
  if (!airtableId) return null

  clearStaleCache()

  const cached = partnerCache.get(airtableId)
  if (cached) return cached

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("partners")
    .select("*")
    .eq("external_id", airtableId)
    .eq("external_source", "airtable")
    .single()

  if (error || !data) return null

  const partner = data as Partner
  partnerCache.set(airtableId, partner)
  return partner
}

/**
 * Bulk lookup - more efficient for multiple partners
 * Returns a Map from Airtable ID to Partner UUID
 *
 * @param airtableIds - Array of Airtable record IDs
 * @returns Map<airtableId, partnerId>
 */
export async function getPartnerIdsByAirtableIds(
  airtableIds: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const uncached: string[] = []

  clearStaleCache()

  // Check cache for each
  for (const airtableId of airtableIds) {
    if (!airtableId) continue

    const cached = partnerCache.get(airtableId)
    if (cached) {
      result.set(airtableId, cached.id)
    } else {
      uncached.push(airtableId)
    }
  }

  // Batch query for uncached
  if (uncached.length > 0) {
    const supabase = await createClient()
    const { data } = await supabase
      .from("partners")
      .select("*")
      .in("external_id", uncached)
      .eq("external_source", "airtable")

    for (const partner of (data || []) as Partner[]) {
      if (partner.external_id) {
        partnerCache.set(partner.external_id, partner)
        result.set(partner.external_id, partner.id)
      }
    }
  }

  return result
}

/**
 * Force clear the cache (useful for testing or after bulk imports)
 */
export function clearPartnerCache(): void {
  partnerCache.clear()
  lastCacheClear = Date.now()
}

/**
 * Get cache statistics (for debugging/monitoring)
 */
export function getPartnerCacheStats(): { size: number; age: number } {
  return {
    size: partnerCache.size,
    age: Date.now() - lastCacheClear,
  }
}

