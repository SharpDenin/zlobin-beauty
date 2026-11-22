#!/usr/bin/env node
/**
 * Reassign category_id for existing EPICA Professional products only.
 * Does not change SKU, name, price, published flags, or photos.
 *
 * Usage: node scripts/epica-reassign-categories.mjs [--api http://localhost:8090] [--dry-run]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mapEpicaToCommerceSlug } from './epica-category-map.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const args = process.argv.slice(2)
const api = arg('--api', process.env.VITE_API_BASE_URL || 'http://localhost:8090')
const dryRun = args.includes('--dry-run')
const email = arg('--email', process.env.SEED_EMAIL || 'supplier1@demo.local')
const password = arg('--password', process.env.SEED_PASSWORD || 'Password123!')
const orgName = arg('--org', 'ПрофиКосмет')
const brand = 'EPICA Professional'
const outPath = resolve(root, arg('--out', 'tmp/epica-reassign-categories-report.json'))

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

const catalog = JSON.parse(readFileSync(resolve(root, 'seed/epica/catalog.json'), 'utf8'))
const bySku = new Map((catalog.products || []).map((p) => [String(p.sku), p]))

const login = await apiJSON('POST', '/v1/auth/login', null, { email, password })
const token = login.access_token
const mine = await apiJSON('GET', '/v1/organizations/mine', token)
const orgID = (mine.items || []).find((r) => r.organization?.name === orgName)?.organization?.id
if (!orgID) {
  console.error('org not found', orgName)
  process.exit(2)
}

const cats = await apiJSON('GET', '/v1/commerce/product-categories', token)
const catBySlug = Object.fromEntries((cats.items || []).map((c) => [c.slug, c]))
const slugById = Object.fromEntries((cats.items || []).map((c) => [c.id, c.slug]))

const products = await apiJSON('GET', `/v1/commerce/products?organization_id=${orgID}`, token)
const epica = (products.items || []).filter((p) => p.brand === brand)
const before = {}
for (const p of epica) {
  const slug = slugById[p.category_id] || 'none'
  before[slug] = (before[slug] || 0) + 1
}

const changes = []
const failures = []
for (const p of epica) {
  const src = bySku.get(String(p.sku))
  if (!src) {
    failures.push({ sku: p.sku, reason: 'missing_catalog_row' })
    continue
  }
  const slug = mapEpicaToCommerceSlug(src.category || '', src.title || p.name || '')
  const cat = catBySlug[slug]
  if (!cat) {
    failures.push({ sku: p.sku, reason: `unknown_slug_${slug}` })
    continue
  }
  const prev = slugById[p.category_id] || null
  if (prev === slug) continue
  changes.push({
    sku: p.sku,
    name: p.name,
    from: prev,
    to: slug,
    id: p.id,
    category_id: cat.id,
  })
}

const afterPlan = { ...before }
for (const ch of changes) {
  afterPlan[ch.from] = (afterPlan[ch.from] || 0) - 1
  if (afterPlan[ch.from] <= 0) delete afterPlan[ch.from]
  afterPlan[ch.to] = (afterPlan[ch.to] || 0) + 1
}

const report = {
  dry_run: dryRun,
  brand,
  org_id: orgID,
  epica_count: epica.length,
  before,
  planned_changes: changes.length,
  after_planned: afterPlan,
  sample_changes: changes.slice(0, 15),
  failures,
}

if (dryRun) {
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

let updated = 0
for (const ch of changes) {
  try {
    await apiJSON('PUT', `/v1/commerce/products/${ch.id}`, token, { category_id: ch.category_id })
    updated += 1
  } catch (err) {
    failures.push({ sku: ch.sku, status: err.status, body: err.body })
  }
}

const products2 = await apiJSON('GET', `/v1/commerce/products?organization_id=${orgID}`, token)
const epica2 = (products2.items || []).filter((p) => p.brand === brand)
const after = {}
let missingCat = 0
for (const p of epica2) {
  const slug = slugById[p.category_id] || 'none'
  if (!p.category_id) missingCat += 1
  after[slug] = (after[slug] || 0) + 1
}

report.updated = updated
report.after = after
report.missing_category_id = missingCat
report.failures = failures
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(report, null, 2))
console.log(JSON.stringify({
  epica_count: epica2.length,
  updated,
  before,
  after,
  missing_category_id: missingCat,
  failures: failures.length,
  out: outPath,
}, null, 2))
