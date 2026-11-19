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
} from './epica-commerce-photos-lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const mediaRoot = resolve(root, 'seed/media')

test('contentTypeForExt maps jpeg/png/webp only', () => {
  assert.equal(contentTypeForExt('.jpg'), 'image/jpeg')
  assert.equal(contentTypeForExt('.JPEG'), 'image/jpeg')
  assert.equal(contentTypeForExt('.png'), 'image/png')
  assert.equal(contentTypeForExt('.webp'), 'image/webp')
  assert.equal(contentTypeForExt('.gif'), null)
})

test('validateImageCandidate accepts real local epica jpeg', () => {
  const path = resolveLocalImagePath(mediaRoot, 'epica/744.jpg')
  assert.ok(path && existsSync(path), 'expected seed/media/epica/744.jpg')
  const bytes = readFileSync(path)
  const v = validateImageCandidate({ bytes, contentType: 'image/jpeg' })
  assert.equal(v.ok, true)
  assert.ok(v.sha256)
  assert.ok(v.size > 1000)
})

test('validateImageCandidate rejects empty and wrong magic', () => {
  assert.equal(validateImageCandidate({ bytes: new Uint8Array(), contentType: 'image/jpeg' }).ok, false)
  assert.equal(
    validateImageCandidate({ bytes: Buffer.from('not-an-image'), contentType: 'image/jpeg' }).reason,
    'magic_mismatch',
  )
  assert.equal(
    validateImageCandidate({ bytes: Buffer.alloc(11 << 20), contentType: 'image/jpeg' }).reason,
    'too_large',
  )
})

test('planPhotoJobs prefers local, skips attached, checkpoints', () => {
  const catalogBySku = new Map([
    ['A', { sku: 'A', imageFile: 'epica/744.jpg', imageUrl: 'https://example.com/a.jpg' }],
    ['B', { sku: 'B', imageFile: 'epica/missing-nope.jpg', imageUrl: 'https://example.com/b.jpg' }],
    ['C', { sku: 'C', imageFile: 'epica/744.jpg' }],
  ])
  const products = [
    { id: '1', sku: 'A', photo_media_id: null },
    { id: '2', sku: 'B', photo_media_id: null },
    { id: '3', sku: 'C', photo_media_id: 'already' },
  ]
  const jobs = planPhotoJobs({
    products,
    catalogBySku,
    checkpoint: {},
    mediaRootDir: mediaRoot,
    allowRemoteUrls: true,
  })
  assert.equal(jobs.find((j) => j.sku === 'A').action, 'upload_local')
  assert.equal(jobs.find((j) => j.sku === 'B').action, 'upload_remote')
  assert.equal(jobs.find((j) => j.sku === 'C').action, 'skip_already_attached')

  const jobsCp = planPhotoJobs({
    products: [{ id: '1', sku: 'A', photo_media_id: null }],
    catalogBySku,
    checkpoint: { A: { media_id: 'm1' } },
    mediaRootDir: mediaRoot,
    allowRemoteUrls: false,
  })
  assert.equal(jobsCp[0].action, 'skip_checkpoint_has_media')
})
