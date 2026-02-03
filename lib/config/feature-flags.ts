/**
 * Feature flags for gradual rollout of schema migration
 *
 * These flags control the transition from the legacy schema (participants_json, partner_airtable_id)
 * to the normalized schema (deal_participants table, partner_id UUID).
 *
 * Rollout order:
 * 1. VALIDATE_STATUS_FIELDS - Always on, catches invalid status values
 * 2. DUAL_WRITE_DEAL_PARTICIPANTS - Write to both participants_json AND deal_participants
 * 3. WRITE_PARTNER_ID_TO_PAYOUTS - Include partner_id (UUID) when creating payouts
 * 4. READ_FROM_NORMALIZED_TABLES - Read from normalized tables (final migration step)
 */

export const FEATURE_FLAGS = {
  /**
   * Phase 1: Dual-write to deal_participants table
   * When enabled, deal create/update operations write to both:
   * - deals.participants_json (legacy)
   * - deal_participants table (normalized)
   */
  DUAL_WRITE_DEAL_PARTICIPANTS: process.env.FEATURE_DUAL_WRITE_PARTICIPANTS === "true",

  /**
   * Phase 2: Include partner_id in payout writes
   * When enabled, payout creation looks up the partner UUID and includes it
   * alongside partner_airtable_id
   */
  WRITE_PARTNER_ID_TO_PAYOUTS: process.env.FEATURE_WRITE_PARTNER_ID === "true",

  /**
   * Phase 3: Read from normalized tables
   * When enabled, read operations use the normalized tables as source of truth
   * Only enable after verifying data consistency between legacy and normalized
   */
  READ_FROM_NORMALIZED_TABLES: process.env.FEATURE_READ_NORMALIZED === "true",

  /**
   * Status validation (should be ON from start)
   * Validates assignment_status and paid_status values before database writes
   * Prevents invalid values that would break ENUM migration
   */
  VALIDATE_STATUS_FIELDS: process.env.FEATURE_VALIDATE_STATUS !== "false",
} as const

export type FeatureFlag = keyof typeof FEATURE_FLAGS

/**
 * Check if a feature flag is enabled
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FEATURE_FLAGS[flag]
}

