#!/usr/bin/env node
/**
 * EPICA product photo batch uploader (local).
 *
 * Default: dry-run (no media upload, no photo_media_id changes).
 * Apply mode requires --apply AND --i-understand-apply (disabled for Stage 6.2 runs).
 *
 * Sources (priority):
 *   1) local seed/media/{imageFile} when present
 *   2) optional --allow-remote imageUrl (public GET only)
 *
 * Usage:
 *   node scripts/epica-commerce-photos.mjs --dry-run
 *   node scripts/epica-commerce-photos.mjs --dry-run --limit 20
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  validateImageCandidate,
  planPhotoJobs,
} from './epica-commerce-photos-lib.mjs'

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
const concurrency = Math.max(1, Math.min(2, Number(arg('--concurrency', '1')) || 1))
const minIntervalMs = Number(arg('--min-interval-ms', '1600')) || 1600
const allowRemote = args.includes('--allow-remote')

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

function loadCheckpoint() {
  if (!existsSync(checkpointPath)) return {}
  try {
    return JSON.parse(readFileSync(checkpointPath, 'utf8'))
  } catch {
    return {}
  }
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const catalogBySku = new Map((catalog.products || []).map((p) => [String(p.sku), p]))
const checkpoint = loadCheckpoint()

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

const jobs = planPhotoJobs({
  products,
  catalogBySku,
  checkpoint,
  mediaRootDir: mediaRoot,
  allowRemoteUrls: allowRemote,
})

const report = {
  dry_run: dryRun,
  apply: wantApply,
  org_id: orgID,
  brand,
  media_root: mediaRoot,
  allow_remote: allowRemote,
  concurrency,
  min_interval_ms: minIntervalMs,
  rate_limit_note: 'media uploadsPerMinute=40; default interval 1600ms keeps under limit',
  epica_products: products.length,
  jobs_total: jobs.length,
  by_action: {},
  would_upload: 0,
  skipped: 0,
  uploaded: 0,
  attached: 0,
  failed: [],
  skipped_details: [],
  prevalidate: [],
  checkpoint_path: checkpointPath,
  note: dryRun
    ? 'Dry-run only: no POST /v1/media and no photo_media_id writes'
    : 'APPLY requested',
}

for (const j of jobs) {
  report.by_action[j.action] = (report.by_action[j.action] || 0) + 1
}

const uploadJobs = jobs.filter((j) => j.action === 'upload_local' || j.action === 'upload_remote')
report.would_upload = uploadJobs.length
report.skipped = jobs.length - uploadJobs.length
report.skipped_details = jobs
  .filter((j) => j.action.startsWith('skip_'))
  .slice(0, 30)
  .map((j) => ({ sku: j.sku, action: j.action }))

for (const j of uploadJobs.filter((x) => x.action === 'upload_local').slice(0, 25)) {
  try {
    const st = statSync(j.path)
    const bytes = readFileSync(j.path)
    const v = validateImageCandidate({ bytes, contentType: j.content_type })
    report.prevalidate.push({ sku: j.sku, path: basename(j.path), size: st.size, ...v })
  } catch (err) {
    report.prevalidate.push({ sku: j.sku, ok: false, reason: String(err.message || err) })
  }
}

if (dryRun) {
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({
    dry_run: true,
    epica_products: report.epica_products,
    would_upload: report.would_upload,
    skipped: report.skipped,
    by_action: report.by_action,
    prevalidate_ok: report.prevalidate.filter((x) => x.ok).length,
    prevalidate_fail: report.prevalidate.filter((x) => !x.ok).length,
    out: reportPath,
  }, null, 2))
  process.exit(0)
}

if (!confirmApply) {
  console.error('Refusing apply without --i-understand-apply (Stage 6.2 safety).')
  process.exit(3)
}

console.error('Apply implementation reserved for a later stage; not executed in 6.2.')
process.exit(3)
