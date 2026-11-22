import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isDuplicateImportAlreadyApplied,
  extractErrorMessage,
  DUPLICATE_IMPORT_APPLIED_MESSAGE,
} from './epica-import-idempotency.mjs'

test('409 with duplicate import already applied is success', () => {
  assert.equal(
    isDuplicateImportAlreadyApplied(409, {
      error: { code: 'conflict', message: 'duplicate import already applied' },
    }),
    true,
  )
  assert.equal(
    isDuplicateImportAlreadyApplied(409, { message: 'duplicate import already applied' }),
    true,
  )
  assert.equal(DUPLICATE_IMPORT_APPLIED_MESSAGE, 'EPICA import already applied; no changes made')
})

test('409 with unrelated conflict is not success', () => {
  assert.equal(
    isDuplicateImportAlreadyApplied(409, {
      error: { code: 'conflict', message: 'sku conflict with existing product' },
    }),
    false,
  )
  assert.equal(
    isDuplicateImportAlreadyApplied(409, { message: 'insufficient stock' }),
    false,
  )
})

test('non-409 errors are never treated as already-applied', () => {
  assert.equal(
    isDuplicateImportAlreadyApplied(401, { message: 'duplicate import already applied' }),
    false,
  )
  assert.equal(
    isDuplicateImportAlreadyApplied(500, { message: 'duplicate import already applied' }),
    false,
  )
  assert.equal(isDuplicateImportAlreadyApplied(400, { message: 'bad request' }), false)
})

test('extractErrorMessage reads nested and flat shapes', () => {
  assert.equal(
    extractErrorMessage({ error: { message: 'duplicate import already applied' } }),
    'duplicate import already applied',
  )
  assert.equal(extractErrorMessage({ message: 'x' }), 'x')
  assert.equal(extractErrorMessage('plain'), 'plain')
  assert.equal(extractErrorMessage(null), '')
})
