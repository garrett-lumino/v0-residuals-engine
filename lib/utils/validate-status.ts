/**
 * Status field validation utilities
 *
 * These functions validate and normalize status values before database writes,
 * ensuring compatibility with the ENUM types defined in the schema.
 *
 * Used to catch invalid values (like "pending_confirmation") before they reach
 * the database, which would cause failures after ENUM migration.
 */

import type { AssignmentStatus, PaidStatus } from "@/lib/types/database"

const VALID_ASSIGNMENT_STATUSES: AssignmentStatus[] = ["unassigned", "pending", "confirmed"]
const VALID_PAID_STATUSES: PaidStatus[] = ["unpaid", "pending", "paid"]

/**
 * Validates and normalizes an assignment status value
 * @param status - Raw status string from input
 * @returns Normalized AssignmentStatus
 * @throws Error if status is invalid
 */
export function validateAssignmentStatus(status: string): AssignmentStatus {
  const normalized = status.toLowerCase().trim()

  if (!VALID_ASSIGNMENT_STATUSES.includes(normalized as AssignmentStatus)) {
    throw new Error(
      `Invalid assignment_status: "${status}". Valid values: ${VALID_ASSIGNMENT_STATUSES.join(", ")}`
    )
  }

  return normalized as AssignmentStatus
}

/**
 * Validates and normalizes a paid status value
 * @param status - Raw status string from input
 * @returns Normalized PaidStatus
 * @throws Error if status is invalid
 */
export function validatePaidStatus(status: string): PaidStatus {
  const normalized = status.toLowerCase().trim()

  if (!VALID_PAID_STATUSES.includes(normalized as PaidStatus)) {
    throw new Error(`Invalid paid_status: "${status}". Valid values: ${VALID_PAID_STATUSES.join(", ")}`)
  }

  return normalized as PaidStatus
}

/**
 * Safe version that returns null instead of throwing
 * Useful for validation without interrupting flow
 */
export function tryValidateAssignmentStatus(status: string): AssignmentStatus | null {
  try {
    return validateAssignmentStatus(status)
  } catch {
    return null
  }
}

/**
 * Safe version that returns null instead of throwing
 */
export function tryValidatePaidStatus(status: string): PaidStatus | null {
  try {
    return validatePaidStatus(status)
  } catch {
    return null
  }
}

