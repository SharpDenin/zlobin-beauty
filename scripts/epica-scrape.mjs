/**
 * Pulls EPICA Professional catalog facts from the official site.
 * Writes seed/epica/catalog.json and optimized product images under seed/media/epica/.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ORIGIN = 'https://epica-professional.com'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_JSON = path.join(ROOT, 'seed', 'epica', 'catalog.json')
const OUT_IMG = path.join(ROOT, 'seed', 'media', 'epica')
const UA = 'Mozilla/5.0 (compatible; SalonXKnowledge/1.0; +https://epica-professional.com/)'

const SERIES_RE = /(COLORSHADE|COLORDREAM|OVERCOLOR|PROXY|SPECIAL\s*BLOND|PASTEL)/i

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.text()
}

function decode(raw) {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function abs(href) {
  if (!href) return ''
  if (href.startsWith('http')) return href.replace('https://epica-professional.com:443', ORIGIN)
  return ORIGIN + (href.startsWith('/') ? href : `/${href}`)
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return out
}

function categoryPaths(html) {
  const found = new Set()
  for (const m of html.matchAll(/href="(\/catalog\/[^"#?]+)"/g)) {
    const href = m[1].replace(/\/+$/, '/')
    if (href.includes('/product/')) continue
    if (href === '/catalog/') continue
    found.add(href)
  }
  return [...found]
}

async function productIdsFromCategory(categoryPath) {
  const ids = new Set()
  for (let page = 1; page <= 40; page++) {
    const url = page === 1
      ? ORIGIN + categoryPath
      : `${ORIGIN}${categoryPath}?PAGEN_1=${page}`
    let html = ''
    try {
      html = await fetchText(url)
    } catch (err) {
      console.warn('category fail', url, err.message)
      break
    }
    const before = ids.size
    for (const m of html.matchAll(/\/catalog\/product\/(\d+)\//g)) ids.add(m[1])
    const hasNext = html.includes(`PAGEN_1=${page + 1}`)
    if (!hasNext || ids.size === before) break
  }
  return ids
}

function block(html, className) {
  const re = new RegExp(`ordered-block ${className}[\\s\\S]*?detail-text-wrap[^>]*>([\\s\\S]*?)</div>`, 'i')
  const m = html.match(re)
  return m ? decode(m[1]) : ''
}

function properties(html) {
  const props = {}
  const re = /js-prop-title">\s*([\s\S]*?)<\/div>[\s\S]*?js-prop-value">\s*([\s\S]*?)<\/div>/g
  for (const m of html.matchAll(re)) {
    const key = decode(m[1]).replace(/\s+/g, ' ')
    const value = decode(m[2]).replace(/\s+/g, ' ')
    if (key && value && !props[key]) props[key] = value
  }
  return props
}

function galleryImage(html) {
  const sized = html.match(/src="(\/upload\/resize_cache\/iblock\/[^"]+450_450[^"]+)"/)
  if (sized) return abs(sized[1])
  const linked = html.match(/<link href="(\/upload\/iblock\/[^"]+)" itemprop="image"/)
  if (linked) return abs(linked[1])
  const og = html.match(/property="og:image" content="([^"]+)"/)
  return og ? abs(og[1]) : ''
}

function parseShade(name) {
  const dotted = name.match(/(\d{1,2}\.\d{1,2})/)
  return dotted ? dotted[1] : ''
}

function parseVolume(name, props) {
  const fromTitle = name.match(/(\d+(?:[.,]\d+)?)\s*мл/i)
  if (fromTitle) return `${fromTitle[1].replace(',', '.')} мл`
  const raw = props['Объем'] || props['Объём'] || ''
  if (!raw) return ''
  if (/мл|ml|г|шт/i.test(raw)) return raw
  if (/^\d+(?:[.,]\d+)?$/.test(raw) && /мл/i.test(name)) return `${raw.replace(',', '.')} мл`
  return raw
}

function parseSeries(name) {
  const m = name.match(SERIES_RE)
  if (!m) return ''
  return m[1].replace(/\s+/g, ' ').toUpperCase()
}

function parseConcentration(name, props) {
  const fromProps = props['Концентрация'] || props['% оксида'] || ''
  if (fromProps) return fromProps
  const m = name.match(/(\d+(?:[.,]\d+)?)\s*%/)
  return m ? `${m[1].replace('.', ',')}%` : ''
}

function parseProduct(id, html) {
  const title = decode((html.match(/<h1 id="pagetitle">([\s\S]*?)<\/h1>/) || [])[1] || '')
  const sku = decode((html.match(/article__value"[^>]*>([^<]+)/) || [])[1] || '')
  const categoryRaw = decode((html.match(/itemprop="category" content="([^"]+)"/) || [])[1] || '')
  const category = categoryRaw.split('/').map((p) => p.trim()).filter(Boolean).join(' / ')
  const props = properties(html)
  const description = block(html, 'desc')
  const composition = block(html, 'composition')
  const usage = block(html, 'use')
  const imageUrl = galleryImage(html)
  const series = parseSeries(title)
  const shadeCode = parseShade(title)
  const volume = parseVolume(title, props)
  const concentration = parseConcentration(title, props)
  const specs = {}
  for (const [k, v] of Object.entries(props)) {
    if (k === 'Объем' || k === 'Объём') continue
    specs[k] = v
  }
  if (concentration && !specs['Концентрация']) specs['Концентрация'] = concentration
  return {
    id,
    title,
    sku,
    category,
    series,
    shadeCode,
    shadeName: props['Цвет'] || '',
    volume,
    description,
    composition,
    usage,
    specs,
    imageUrl,
    sourceUrl: `${ORIGIN}/catalog/product/${id}/`,
  }
}

async function downloadImage(product) {
  if (!product.imageUrl) return ''
  const ext = path.extname(new URL(product.imageUrl).pathname).toLowerCase() || '.jpg'
  const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg'
  const file = `${product.id}${safeExt}`
  try {
    const res = await fetch(product.imageUrl, { headers: { 'User-Agent': UA } })
    if (!res.ok) return ''
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 800 || buf.length > 1_500_000) return ''
    await writeFile(path.join(OUT_IMG, file), buf)
    return `epica/${file}`
  } catch {
    return ''
  }
}

const indexHtml = await fetchText(`${ORIGIN}/catalog/okrashivanie-i-osvetlenie/okrashivanie/`)
const paths = categoryPaths(indexHtml)
console.log('categories', paths.length)

const idSet = new Set()
await mapPool(paths, 4, async (categoryPath) => {
  const ids = await productIdsFromCategory(categoryPath)
  for (const id of ids) idSet.add(id)
  console.log(categoryPath, ids.size)
})
const ids = [...idSet]
console.log('unique products', ids.length)

await mkdir(path.dirname(OUT_JSON), { recursive: true })
await mkdir(OUT_IMG, { recursive: true })

let done = 0
const products = (await mapPool(ids, 6, async (id) => {
  try {
    const html = await fetchText(`${ORIGIN}/catalog/product/${id}/`)
    const product = parseProduct(id, html)
    if (!product.title) return null
    product.imageFile = await downloadImage(product)
    done++
    if (done % 25 === 0) console.log('parsed', done, '/', ids.length)
    return product
  } catch (err) {
    console.warn('product fail', id, err.message)
    return null
  }
})).filter(Boolean)

products.sort((a, b) => a.category.localeCompare(b.category, 'ru') || a.title.localeCompare(b.title, 'ru'))

const catalog = {
  source: 'EPICA Professional official website',
  sourceUrl: `${ORIGIN}/`,
  brandUrl: `${ORIGIN}/brand/`,
  catalogUrl: `${ORIGIN}/catalog/`,
  fetchedAt: new Date().toISOString(),
  products,
}
await writeFile(OUT_JSON, JSON.stringify(catalog, null, 2))
const withImage = products.filter((p) => p.imageFile).length
const coloring = products.filter((p) => p.category.startsWith('Окрашивание')).length
console.log(JSON.stringify({ products: products.length, withImage, coloring, file: OUT_JSON }, null, 2))
