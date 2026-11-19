/**
 * Helpers for EPICA commerce CSV import idempotency (HTTP 409 handling).
 * Only treat a 409 as success when the server confirms the same checksum was already applied.
 */

export const DUPLICATE_IMPORT_APPLIED_MESSAGE = 'EPICA import already applied; no changes made'

/**
 * @param {number} status
 * @param {unknown} body
 * @returns {boolean}
 */
export function isDuplicateImportAlreadyApplied(status, body) {
  if (status !== 409) return false
  const message = extractErrorMessage(body)
  if (!message) return false
  const normalized = message.toLowerCase().trim()
  return (
    normalized === 'duplicate import already applied' ||
    normalized.includes('duplicate import already applied')
  )
}

/**
 * @param {unknown} body
 * @returns {string}
 */
export function extractErrorMessage(body) {
  if (body == null) return ''
  if (typeof body === 'string') return body
  if (typeof body !== 'object') return String(body)
  const obj = /** @type {Record<string, unknown>} */ (body)
  if (typeof obj.message === 'string') return obj.message
  if (typeof obj.error === 'string') return obj.error
  if (obj.error && typeof obj.error === 'object') {
    const nested = /** @type {Record<string, unknown>} */ (obj.error)
    if (typeof nested.message === 'string') return nested.message
  }
  return ''
}
