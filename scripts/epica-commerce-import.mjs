#!/usr/bin/env node
/**
 * Local-only EPICA commerce import via staff CSV import + product publish PATCH.
 * Reads tmp/epica-price-match.json (official prices). Does not invent prices or stock.
 *
 * Usage:
 *   node scripts/epica-commerce-import.mjs [--api http://localhost:8090] [--dry-run]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mapEpicaToCommerceSlug } from './epica-category-map.mjs'
import {
  isDuplicateImportAlreadyApplied,
  DUPLICATE_IMPORT_APPLIED_MESSAGE,
} from './epica-import-idempotency.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const args = process.argv.slice(2)
const api = arg('--api', process.env.VITE_API_BASE_URL || 'http://localhost:8090')
const dryRun = args.includes('--dry-run')
const email = arg('--email', process.env.SEED_EMAIL || 'supplier1@demo.local')
const password = arg('--password', process.env.SEED_PASSWORD || 'Password123!')
const orgName = arg('--org', 'ПрофиКосмет')
const brand = 'EPICA Professional'
const matchPath = resolve(root, arg('--match', 'tmp/epica-price-match.json'))
const outPath = resolve(root, arg('--out', 'tmp/epica-commerce-import-report.json'))

function arg(flag, fallback) {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : fallback
}

function csvEscape(v) {
  const s = String(v ?? '')
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

async function apiJSON(method, path, token, body, headers = {}) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body instanceof Uint8Array ? body : body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status}`)
    err.status = res.status
    err.body = data
    throw err
  }
  return data
}

const match = JSON.parse(readFileSync(matchPath, 'utf8'))
const catalog = JSON.parse(readFileSync(resolve(root, 'seed/epica/catalog.json'), 'utf8'))
const catalogBySku = new Map((catalog.products || []).map((p) => [String(p.sku), p]))
const priced = (match.items || [])
  .filter((x) => x.ok && Number(x.price_rub) > 0)
  .map((x) => {
    const src = catalogBySku.get(String(x.sku)) || {}
    return {
      ...x,
      title: x.title || src.title,
      category: x.category || src.category || '',
      volume: x.volume || src.volume || '',
      imageFile: x.imageFile || src.imageFile || '',
    }
  })
if (priced.length === 0) {
  console.error('no priced items in', matchPath)
  process.exit(1)
}

const login = await apiJSON('POST', '/v1/auth/login', null, { email, password })
const token = login.access_token
const mine = await apiJSON('GET', '/v1/organizations/mine', token)

let orgID = null
if (Array.isArray(mine.items)) {
  const hit = mine.items.find((r) => r.organization?.name === orgName)
  orgID = hit?.organization?.id || null
} else if (Array.isArray(mine)) {
  const hit = mine.find((r) => r.organization?.name === orgName || r.name === orgName)
  orgID = hit?.organization?.id || hit?.id || null
}
if (!orgID) {
  const report = {
    blocker: `supplier organization "${orgName}" not found for ${email}`,
    mine,
    imported: 0,
    published: 0,
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.error(JSON.stringify(report, null, 2))
  process.exit(2)
}

const cats = await apiJSON('GET', '/v1/commerce/product-categories', token)
const catBySlug = Object.fromEntries((cats.items || []).map((c) => [c.slug, c.id]))

const rows = priced.map((p) => {
  const slug = mapEpicaToCommerceSlug(p.category || '', p.title || '')
  return {
    sku: String(p.sku),
    brand,
    name: p.title,
    unit: 'pcs',
    price_rubles: String(p.price_rub),
    min_stock: '0',
    // intentionally omit qty_on_hand — no fictional stock
    category_slug: slug,
    category_id: catBySlug[slug] || null,
    volume: p.volume || '',
    source_url: p.url || p.sourceUrl || '',
    checked_at: match.checked_at,
  }
})

const csv = [
  'sku,brand,name,unit,price_rubles,min_stock',
  ...rows.map((r) => [r.sku, r.brand, r.name, r.unit, r.price_rubles, r.min_stock].map(csvEscape).join(',')),
].join('\n')

const summary = {
  api,
  org_id: orgID,
  org_name: orgName,
  brand,
  checked_at: match.checked_at,
  source: match.source,
  priced_candidates: rows.length,
  category_slugs_used: [...new Set(rows.map((r) => r.category_slug))],
  dry_run: dryRun,
  import_job_id: null,
  created_or_updated: 0,
  published: 0,
  publish_failures: [],
  category_patch_failures: [],
  already_applied: false,
  note: 'No original_price column in commerce schema; retail sale price stored in price_minor only. Photos not bulk-uploaded (media rate limits).',
}

if (dryRun) {
  summary.csv_preview_rows = rows.slice(0, 3)
  writeFileSync(outPath, JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
  process.exit(0)
}

let validate
try {
  validate = await apiJSON(
    'POST',
    `/v1/commerce/imports/products/validate?organization_id=${orgID}`,
    token,
    new TextEncoder().encode(csv),
    { 'Content-Type': 'text/csv; charset=utf-8' },
  )
} catch (err) {
  if (isDuplicateImportAlreadyApplied(err.status, err.body)) {
    summary.already_applied = true
    summary.validate_status = 409
    summary.validate_error = err.body
    writeFileSync(outPath, JSON.stringify(summary, null, 2))
    console.log(DUPLICATE_IMPORT_APPLIED_MESSAGE)
    process.exit(0)
  }
  summary.validate_status = err.status
  summary.validate_error = err.body
  writeFileSync(outPath, JSON.stringify(summary, null, 2))
  console.error(`import validate failed: HTTP ${err.status}`, err.body)
  process.exit(1)
}

summary.import_job_id = validate.id
summary.validate_status = validate.status
summary.validate_errors = validate.report?.errors || []
if ((validate.report?.errors || []).length) {
  writeFileSync(outPath, JSON.stringify(summary, null, 2))
  console.error('validation failed', summary.validate_errors.slice(0, 20))
  process.exit(3)
}

const applied = await apiJSON('POST', `/v1/commerce/imports/${validate.id}/apply`, token, {})
summary.apply_status = applied.status
summary.apply_report = applied.report
summary.created_or_updated = applied.report?.applied ?? applied.report?.row_count ?? rows.length

// Load org products and publish EPICA SKUs + set categories / volume.
const products = await apiJSON('GET', `/v1/commerce/products?organization_id=${orgID}&limit=1000`, token)
const bySku = new Map((products.items || []).map((p) => [String(p.sku), p]))
let published = 0
for (const row of rows) {
  const p = bySku.get(row.sku)
  if (!p) {
    summary.publish_failures.push({ sku: row.sku, reason: 'missing_after_import' })
    continue
  }
  const patch = {
    brand,
    name: row.name,
    price_minor: Math.round(Number(row.price_rubles) * 100),
    published: true,
    for_sale: true,
    audience: 'all',
    unit: 'pcs',
    min_stock: 0,
  }
  if (row.category_id) patch.category_id = row.category_id
  if (row.volume) patch.volume_label = row.volume
  try {
    await apiJSON('PUT', `/v1/commerce/products/${p.id}`, token, patch)
    published += 1
  } catch (err) {
    summary.publish_failures.push({ sku: row.sku, status: err.status, body: err.body })
  }
}
summary.published = published

// Verify shop filter
const shop = await apiJSON(
  'GET',
  `/v1/commerce/shop/products?brand=${encodeURIComponent(brand)}&limit=100`,
  token,
)
summary.shop_brand_count = (shop.items || []).length
summary.shop_sample = (shop.items || []).slice(0, 5).map((p) => ({
  sku: p.sku,
  name: p.name,
  price_minor: p.price_minor,
  brand: p.brand,
}))

writeFileSync(outPath, JSON.stringify(summary, null, 2))
console.log(JSON.stringify({
  org_id: orgID,
  priced_candidates: rows.length,
  created_or_updated: summary.created_or_updated,
  published: summary.published,
  shop_brand_count: summary.shop_brand_count,
  publish_failures: summary.publish_failures.length,
  out: outPath,
}, null, 2))
