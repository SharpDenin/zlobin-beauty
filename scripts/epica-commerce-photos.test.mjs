import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  contentTypeForExt,
  validateImageCandidate,
  resolveLocalImagePath,
  planPhotoJobs,
  prevalidateLocalCatalog,
  isRetryableStatus,
  backoffMs,
} from './epica-commerce-photos-lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const mediaRoot = resolve(root, 'seed/media')

test('contentTypeForExt maps jpeg/png/webp only', () => {
  assert.equal(contentTypeForExt('.jpg'), 'image/jpeg')
  assert.equal(contentTypeForExt('.png'), 'image/png')
  assert.equal(contentTypeForExt('.gif'), null)
})

test('validateImageCandidate accepts real local epica jpeg', () => {
  const path = resolveLocalImagePath(mediaRoot, 'epica/744.jpg')
  assert.ok(path && existsSync(path))
  const bytes = readFileSync(path)
  const v = validateImageCandidate({ bytes, contentType: 'image/jpeg' })
  assert.equal(v.ok, true)
  assert.ok(v.sha256)
})

test('validateImageCandidate rejects empty and wrong magic', () => {
  assert.equal(validateImageCandidate({ bytes: new Uint8Array(), contentType: 'image/jpeg' }).ok, false)
  assert.equal(
    validateImageCandidate({ bytes: Buffer.from('not-an-image'), contentType: 'image/jpeg' }).reason,
    'magic_mismatch',
  )
})

test('planPhotoJobs prefers local, skips attached, attaches checkpoint media', () => {
  const catalogBySku = new Map([
    ['A', { sku: 'A', imageFile: 'epica/744.jpg' }],
    ['B', { sku: 'B', imageFile: 'epica/missing-nope.jpg' }],
    ['C', { sku: 'C', imageFile: 'epica/744.jpg' }],
    ['D', { sku: 'D', imageFile: 'epica/744.jpg' }],
  ])
  const products = [
    { id: '1', sku: 'A', photo_media_id: null },
    { id: '2', sku: 'B', photo_media_id: null },
    { id: '3', sku: 'C', photo_media_id: 'already' },
    { id: '4', sku: 'D', photo_media_id: null },
  ]
  const jobs = planPhotoJobs({
    products,
    catalogBySku,
    checkpoint: { D: { media_id: 'm-d', linked: false } },
    mediaRootDir: mediaRoot,
    allowRemoteUrls: false,
  })
  assert.equal(jobs.find((j) => j.sku === 'A').action, 'upload_local')
  assert.equal(jobs.find((j) => j.sku === 'B').action, 'skip_no_source')
  assert.equal(jobs.find((j) => j.sku === 'C').action, 'skip_already_attached')
  assert.equal(jobs.find((j) => j.sku === 'D').action, 'attach_existing')
  assert.equal(jobs.find((j) => j.sku === 'D').media_id, 'm-d')
})

test('prevalidateLocalCatalog covers catalog sample and detects sha groups', () => {
  const catalog = JSON.parse(readFileSync(resolve(root, 'seed/epica/catalog.json'), 'utf8'))
  const catalogBySku = new Map(catalog.products.map((p) => [String(p.sku), p]))
  const products = catalog.products.slice(0, 30).map((p) => ({ id: `id-${p.sku}`, sku: p.sku, photo_media_id: null }))
  const pre = prevalidateLocalCatalog({ products, catalogBySku, mediaRootDir: mediaRoot })
  assert.equal(pre.validated_ok, products.length)
  assert.equal(pre.validated_fail, 0)
  assert.ok(pre.unique_sha256 >= 1)
})

test('retry helpers', () => {
  assert.equal(isRetryableStatus(429), true)
  assert.equal(isRetryableStatus(500), false)
  assert.equal(backoffMs(1), 8000)
  assert.equal(backoffMs(3), 32000)
  assert.equal(backoffMs(10), 45000)
})
