#!/usr/bin/env node
/**
 * Match seed/epica/catalog.json SKUs to official epica-professional.com prices.
 * Writes a report JSON; does not invent prices. Safe to re-run.
 *
 * Usage (from repo root, host or Docker with network):
 *   node scripts/epica-price-match.mjs [--limit N] [--out path]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const catalogPath = resolve(root, 'seed/epica/catalog.json')

const args = process.argv.slice(2)
function argVal(flag, fallback) {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : fallback
}
const limit = Number(argVal('--limit', '0')) || 0
const outPath = resolve(root, argVal('--out', 'tmp/epica-price-match.json'))
const concurrency = Number(argVal('--concurrency', '4')) || 4
const delayMs = Number(argVal('--delay-ms', '120')) || 120

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const products = Array.isArray(catalog.products) ? catalog.products : []
const checkedAt = new Date().toISOString()
const sourceBase = 'https://epica-professional.com'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function decodePriceChunk(raw) {
  // Official site uses NBSP / &nbsp; as thousands separator: "1&nbsp;430" → 1430.
  return String(raw || '')
    .replace(/&nbsp;|&#160;|\u00a0/gi, '')
    .replace(/\s/g, '')
    .replace(',', '.')
}

function parsePriceRub(html) {
  const vals = [...html.matchAll(/price_value">\s*([^<]+)/g)]
    .map((m) => Number(decodePriceChunk(m[1])))
    .filter((n) => Number.isFinite(n) && n > 0)
  const oldVals = [...html.matchAll(/price_value_old">\s*([^<]+)|class="[^"]*old[^"]*price[^"]*"[^>]*>\s*([^<]+)/gi)]
    .map((m) => Number(decodePriceChunk(m[1] || m[2])))
    .filter((n) => Number.isFinite(n) && n > 0)

  const unique = [...new Set(vals)]
  if (unique.length === 0) return null
  // Prefer the first product price_value as current retail.
  const price = unique[0]
  const original = oldVals.find((o) => o > price) ?? null
  return {
    price_rub: price,
    original_price_rub: original && original !== price ? original : null,
  }
}

function extractSku(html) {
  const patterns = [
    /Артикул[\s\S]{0,120}?>(\d{3,})/i,
    /"sku"\s*:\s*"?(\d{3,})"?/i,
    /data-product-article="(\d{3,})"/i,
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m) return m[1]
  }
  return null
}

async function fetchProduct(p) {
  const url = p.sourceUrl || `${sourceBase}/catalog/product/${p.id}/`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'SalonX-EpicaPriceMatch/1.0 (+local staging; contact ops)',
      Accept: 'text/html',
    },
    redirect: 'follow',
  })
  const html = await res.text()
  if (!res.ok) {
    return { ok: false, status: res.status, url, reason: `http_${res.status}` }
  }
  const pageSku = extractSku(html)
  const prices = parsePriceRub(html)
  if (!prices) {
    return { ok: false, status: res.status, url, pageSku, reason: 'price_not_found' }
  }
  if (pageSku && String(p.sku) !== String(pageSku)) {
    return {
      ok: false,
      status: res.status,
      url,
      pageSku,
      reason: 'sku_mismatch',
      price_rub: prices.price_rub,
      original_price_rub: prices.original_price_rub,
    }
  }
  return {
    ok: true,
    status: res.status,
    url,
    pageSku: pageSku || String(p.sku),
    price_rub: prices.price_rub,
    original_price_rub: prices.original_price_rub,
  }
}

async function mapPool(items, n, fn) {
  const out = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx], idx)
      if (delayMs > 0) await sleep(delayMs)
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()))
  return out
}

const slice = limit > 0 ? products.slice(0, limit) : products
console.error(`matching ${slice.length}/${products.length} products…`)

const rows = await mapPool(slice, concurrency, async (p) => {
  try {
    const match = await fetchProduct(p)
    return {
      id: p.id,
      sku: String(p.sku || ''),
      title: p.title,
      category: p.category || '',
      volume: p.volume || '',
      imageFile: p.imageFile || '',
      sourceUrl: p.sourceUrl || '',
      ...match,
    }
  } catch (err) {
    return {
      id: p.id,
      sku: String(p.sku || ''),
      title: p.title,
      ok: false,
      reason: 'fetch_error',
      error: String(err?.message || err),
      sourceUrl: p.sourceUrl || '',
    }
  }
})

const priced = rows.filter((r) => r.ok)
const unmatched = rows.filter((r) => !r.ok)
const byReason = {}
for (const r of unmatched) {
  byReason[r.reason || 'unknown'] = (byReason[r.reason || 'unknown'] || 0) + 1
}

const report = {
  checked_at: checkedAt,
  source: sourceBase,
  catalog_path: 'seed/epica/catalog.json',
  catalog_total: products.length,
  checked: rows.length,
  matched_with_price: priced.length,
  unmatched: unmatched.length,
  unmatched_by_reason: byReason,
  note:
    'commerce products.price_minor has no original_price/compare_at field; sale price maps to price_minor only.',
  items: rows,
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(report, null, 2))
console.log(JSON.stringify({
  checked_at: checkedAt,
  catalog_total: products.length,
  checked: rows.length,
  matched_with_price: priced.length,
  unmatched: unmatched.length,
  unmatched_by_reason: byReason,
  out: outPath,
}, null, 2))
