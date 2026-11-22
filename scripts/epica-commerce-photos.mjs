#!/usr/bin/env node
/**
 * EPICA product photo batch uploader (local).
 *
 * Default: dry-run (no media upload, no photo_media_id changes).
 * Apply:
 *   node scripts/epica-commerce-photos.mjs --apply --i-understand-apply
 *
 * Sources: local seed/media/{imageFile} only unless --allow-remote.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  validateImageCandidate,
  planPhotoJobs,
  prevalidateLocalCatalog,
  sleep,
  backoffMs,
  isRetryableStatus,
  contentTypeForExt,
} from './epica-commerce-photos-lib.mjs'
import { extname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const args = process.argv.slice(2)
const api = arg('--api', process.env.VITE_API_BASE_URL || 'http://localhost:8090')
const wantApply = args.includes('--apply')
const confirmApply = args.includes('--i-understand-apply')
const dryRun = !wantApply
const email = arg('--email', process.env.SEED_EMAIL || 'supplier1@demo.local')
const password = arg('--password', process.env.SEED_PASSWORD || 'Password123!')
const orgName = arg('--org', 'ПрофиКосмет')
const brand = 'EPICA Professional'
const mediaRoot = resolve(root, arg('--media-root', 'seed/media'))
const catalogPath = resolve(root, 'seed/epica/catalog.json')
const checkpointPath = resolve(root, arg('--checkpoint', 'tmp/epica-photo-checkpoint.json'))
const reportPath = resolve(root, arg('--out', 'tmp/epica-photo-batch-report.json'))
const limit = Number(arg('--limit', '0')) || 0
const minIntervalMs = Number(arg('--min-interval-ms', '1600')) || 1600
const allowRemote = args.includes('--allow-remote')
const maxAttempts = Number(arg('--max-attempts', '8')) || 8

function arg(flag, fallback) {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : fallback
}

async function apiJSON(method, path, token, body) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status}`)
    err.status = res.status
    err.body = data
    throw err
  }
  return data
}

async function uploadMedia(token, bytes, filename, contentType) {
  const form = new FormData()
  form.append('purpose', 'product')
  form.append('file', new Blob([bytes], { type: contentType }), filename)
  const res = await fetch(`${api}/v1/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new Error(`POST /v1/media → ${res.status}`)
    err.status = res.status
    err.body = data
    throw err
  }
  return data
}

function loadCheckpoint() {
  if (!existsSync(checkpointPath)) return { skus: {}, sha_to_media: {} }
  try {
    const raw = JSON.parse(readFileSync(checkpointPath, 'utf8'))
    if (raw.skus) return { skus: raw.skus || {}, sha_to_media: raw.sha_to_media || {} }
    // legacy flat sku→entry
    return { skus: raw, sha_to_media: {} }
  } catch {
    return { skus: {}, sha_to_media: {} }
  }
}

function saveCheckpoint(cp) {
  mkdirSync(dirname(checkpointPath), { recursive: true })
  writeFileSync(checkpointPath, JSON.stringify(cp, null, 2))
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const catalogBySku = new Map((catalog.products || []).map((p) => [String(p.sku), p]))

const login = await apiJSON('POST', '/v1/auth/login', null, { email, password })
const token = login.access_token
const mine = await apiJSON('GET', '/v1/organizations/mine', token)
const orgID = (mine.items || []).find((r) => r.organization?.name === orgName)?.organization?.id
if (!orgID) {
  console.error('org not found', orgName)
  process.exit(2)
}
const productsRes = await apiJSON('GET', `/v1/commerce/products?organization_id=${orgID}&limit=1000`, token)
let products = (productsRes.items || []).filter((p) => p.brand === brand)
if (limit > 0) products = products.slice(0, limit)

const pre = prevalidateLocalCatalog({ products, catalogBySku, mediaRootDir: mediaRoot })
const checkpoint = loadCheckpoint()

const jobs = planPhotoJobs({
  products,
  catalogBySku,
  checkpoint: checkpoint.skus,
  mediaRootDir: mediaRoot,
  allowRemoteUrls: allowRemote,
})

const report = {
  dry_run: dryRun,
  apply: wantApply,
  started_at: new Date().toISOString(),
  finished_at: null,
  duration_ms: null,
  org_id: orgID,
  brand,
  actor_email: email,
  media_root: mediaRoot,
  allow_remote: allowRemote,
  min_interval_ms: minIntervalMs,
  epica_products: products.length,
  prevalidate: {
    total_sku: pre.unique_skus,
    found_images: pre.found_files,
    validated_ok: pre.validated_ok,
    validated_fail: pre.validated_fail,
    already_has_photo: pre.already_has_photo,
    unique_sha256: pre.unique_sha256,
    duplicate_content_groups: pre.duplicate_content_groups,
    failures: pre.failures.map((f) => ({ sku: f.sku, reason: f.reason, imageFile: f.imageFile })),
  },
  jobs_total: jobs.length,
  by_action: {},
  would_upload: 0,
  uploaded: 0,
  reused_sha: 0,
  attached: 0,
  skipped: 0,
  failed: [],
  uploaded_unlinked: [],
  checkpoint_path: checkpointPath,
}

for (const j of jobs) {
  report.by_action[j.action] = (report.by_action[j.action] || 0) + 1
}
report.would_upload = jobs.filter((j) => j.action === 'upload_local' || j.action === 'upload_remote').length
report.skipped = jobs.filter((j) => j.action.startsWith('skip_')).length

console.log(JSON.stringify({
  phase: 'prevalidate',
  total_sku: report.prevalidate.total_sku,
  found_images: report.prevalidate.found_images,
  validated_ok: report.prevalidate.validated_ok,
  validated_fail: report.prevalidate.validated_fail,
  unique_sha256: report.prevalidate.unique_sha256,
  already_has_photo: report.prevalidate.already_has_photo,
  duplicate_groups: report.prevalidate.duplicate_content_groups.length,
  by_action: report.by_action,
}, null, 2))

if (dryRun) {
  report.finished_at = new Date().toISOString()
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ dry_run: true, out: reportPath }, null, 2))
  process.exit(report.prevalidate.validated_fail ? 1 : 0)
}

if (!confirmApply) {
  console.error('Refusing apply without --i-understand-apply')
  process.exit(3)
}

if (allowRemote) {
  console.error('Stage 6.3 forbids remote CDN; refuse --allow-remote on apply')
  process.exit(3)
}

const start = Date.now()
const shaToMedia = { ...(checkpoint.sha_to_media || {}) }
const preBySku = new Map(pre.rows.map((r) => [r.sku, r]))
let lastUploadAt = 0

async function ensureUploadInterval() {
  const wait = minIntervalMs - (Date.now() - lastUploadAt)
  if (wait > 0) await sleep(wait)
}

async function uploadWithRetry(bytes, filename, contentType) {
  let lastErr = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await ensureUploadInterval()
    try {
      const out = await uploadMedia(token, bytes, filename, contentType)
      lastUploadAt = Date.now()
      return out
    } catch (err) {
      lastErr = err
      lastUploadAt = Date.now()
      if (!isRetryableStatus(err.status) || attempt === maxAttempts) throw err
      const wait = backoffMs(attempt)
      console.error(`retry upload ${filename} attempt=${attempt} status=${err.status} sleep=${wait}`)
      await sleep(wait)
    }
  }
  throw lastErr
}

async function attachWithRetry(productId, mediaId) {
  let lastErr = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await apiJSON('PUT', `/v1/commerce/products/${productId}`, token, { photo_media_id: mediaId })
      return
    } catch (err) {
      lastErr = err
      if (!isRetryableStatus(err.status) || attempt === maxAttempts) throw err
      await sleep(backoffMs(attempt))
    }
  }
  throw lastErr
}

for (const job of jobs) {
  if (job.action === 'skip_already_attached' || job.action === 'skip_no_source') {
    continue
  }

  const sku = job.sku
  try {
    let mediaId = null
    let sha256 = null
    let uploadedNow = false
    let reused = false

    if (job.action === 'attach_existing') {
      mediaId = job.media_id
      sha256 = job.sha256 || checkpoint.skus[sku]?.sha256 || null
    } else if (job.action === 'upload_local') {
      const pv = preBySku.get(sku)
      if (!pv?.ok) {
        report.failed.push({ sku, stage: 'prevalidate', reason: pv?.reason || 'invalid' })
        continue
      }
      sha256 = pv.sha256
      if (shaToMedia[sha256]) {
        mediaId = shaToMedia[sha256]
        reused = true
        report.reused_sha += 1
      } else {
        const bytes = readFileSync(job.path)
        const ct = job.content_type || contentTypeForExt(extname(job.path))
        const v = validateImageCandidate({ bytes, contentType: ct })
        if (!v.ok) {
          report.failed.push({ sku, stage: 'revalidate', reason: v.reason })
          continue
        }
        const up = await uploadWithRetry(bytes, basename(job.path), ct)
        mediaId = up.id
        uploadedNow = true
        report.uploaded += 1
        shaToMedia[sha256] = mediaId
        // Persist media id immediately (before attach) so a crash does not lose the upload.
        checkpoint.skus[sku] = {
          media_id: mediaId,
          sha256,
          linked: false,
          product_id: job.product_id,
          imageFile: job.imageFile,
          uploaded_at: new Date().toISOString(),
        }
        checkpoint.sha_to_media = shaToMedia
        saveCheckpoint(checkpoint)
      }
    } else {
      report.failed.push({ sku, stage: 'plan', reason: `unsupported_action_${job.action}` })
      continue
    }

    if (!mediaId) {
      report.failed.push({ sku, stage: 'upload', reason: 'missing_media_id' })
      continue
    }

    // Guard: never attach media resolved for a different SKU job product.
    if (job.product_id !== products.find((p) => String(p.sku) === sku)?.id) {
      report.failed.push({ sku, stage: 'guard', reason: 'product_id_mismatch' })
      continue
    }

    await attachWithRetry(job.product_id, mediaId)
    report.attached += 1
    checkpoint.skus[sku] = {
      media_id: mediaId,
      sha256,
      linked: true,
      product_id: job.product_id,
      imageFile: job.imageFile || checkpoint.skus[sku]?.imageFile || null,
      uploaded_at: checkpoint.skus[sku]?.uploaded_at || null,
      linked_at: new Date().toISOString(),
      reused_sha: reused || undefined,
      uploaded_now: uploadedNow || undefined,
    }
    checkpoint.sha_to_media = shaToMedia
    saveCheckpoint(checkpoint)

    if ((report.attached + report.failed.length) % 25 === 0) {
      console.log(JSON.stringify({
        progress: true,
        attached: report.attached,
        uploaded: report.uploaded,
        reused_sha: report.reused_sha,
        failed: report.failed.length,
        elapsed_ms: Date.now() - start,
      }))
    }
  } catch (err) {
    const entry = {
      sku,
      stage: 'apply',
      status: err.status || null,
      body: err.body || null,
      message: String(err.message || err),
    }
    if (checkpoint.skus[sku]?.media_id && !checkpoint.skus[sku]?.linked) {
      report.uploaded_unlinked.push({ sku, media_id: checkpoint.skus[sku].media_id })
    }
    report.failed.push(entry)
    console.error('fail', JSON.stringify(entry))
  }
}

report.finished_at = new Date().toISOString()
report.duration_ms = Date.now() - start
checkpoint.sha_to_media = shaToMedia
saveCheckpoint(checkpoint)
mkdirSync(dirname(reportPath), { recursive: true })
writeFileSync(reportPath, JSON.stringify(report, null, 2))
console.log(JSON.stringify({
  apply: true,
  uploaded: report.uploaded,
  reused_sha: report.reused_sha,
  attached: report.attached,
  skipped: report.skipped,
  failed: report.failed.length,
  uploaded_unlinked: report.uploaded_unlinked.length,
  duration_ms: report.duration_ms,
  out: reportPath,
}, null, 2))
process.exit(report.failed.length ? 1 : 0)
