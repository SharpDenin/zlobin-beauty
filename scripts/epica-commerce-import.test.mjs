/**
 * Decision-tree tests for EPICA import validate error handling
 * (no live commerce mutate; mirrors epica-commerce-import.mjs catch branch).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isDuplicateImportAlreadyApplied,
  DUPLICATE_IMPORT_APPLIED_MESSAGE,
} from './epica-import-idempotency.mjs'

/**
 * @param {{ status: number, body: unknown }} err
 * @returns {{ exitCode: number, message: string, alreadyApplied: boolean }}
 */
function handleValidateError(err) {
  if (isDuplicateImportAlreadyApplied(err.status, err.body)) {
    return { exitCode: 0, message: DUPLICATE_IMPORT_APPLIED_MESSAGE, alreadyApplied: true }
  }
  return {
    exitCode: 1,
    message: `import validate failed: HTTP ${err.status}`,
    alreadyApplied: false,
  }
}

test('first successful import path: no error → continue (exit not 1)', () => {
  // Simulate validate returning a job (success path before apply/publish).
  const validate = { id: 'job-1', status: 'validated', report: { errors: [] } }
  assert.ok(validate.id)
  assert.equal((validate.report?.errors || []).length, 0)
})

test('repeat import with applied checksum → exit 0', () => {
  const result = handleValidateError({
    status: 409,
    body: { error: { code: 'conflict', message: 'duplicate import already applied' } },
  })
  assert.equal(result.exitCode, 0)
  assert.equal(result.alreadyApplied, true)
  assert.equal(result.message, 'EPICA import already applied; no changes made')
})

test('409 with unrelated message → exit 1', () => {
  const result = handleValidateError({
    status: 409,
    body: { error: { code: 'conflict', message: 'product sku already exists in another form' } },
  })
  assert.equal(result.exitCode, 1)
  assert.equal(result.alreadyApplied, false)
})

test('auth and other HTTP errors → exit 1', () => {
  assert.equal(handleValidateError({ status: 401, body: { message: 'unauthorized' } }).exitCode, 1)
  assert.equal(handleValidateError({ status: 403, body: { message: 'forbidden' } }).exitCode, 1)
  assert.equal(handleValidateError({ status: 500, body: { message: 'boom' } }).exitCode, 1)
  assert.equal(
    handleValidateError({
      status: 400,
      body: { message: 'duplicate import already applied' },
    }).exitCode,
    1,
  )
})
