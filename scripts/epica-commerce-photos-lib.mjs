import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, extname, basename } from 'node:path'

export const ALLOWED_CT = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const MAX_BYTES = 10 << 20

export function contentTypeForExt(ext) {
  switch (String(ext || '').toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    default:
      return null
  }
}

export function validateImageCandidate({ bytes, contentType, maxBytes = MAX_BYTES }) {
  if (!bytes || !bytes.length) return { ok: false, reason: 'empty' }
  if (bytes.length > maxBytes) return { ok: false, reason: 'too_large' }
  if (!ALLOWED_CT.has(contentType)) return { ok: false, reason: 'unsupported_format' }
  const b0 = bytes[0]
  const b1 = bytes[1]
  const b2 = bytes[2]
  const b3 = bytes[3]
  const isJpeg = b0 === 0xff && b1 === 0xd8
  const isPng = b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47
  const isWebp = b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46
  if (contentType === 'image/jpeg' && !isJpeg) return { ok: false, reason: 'magic_mismatch' }
  if (contentType === 'image/png' && !isPng) return { ok: false, reason: 'magic_mismatch' }
  if (contentType === 'image/webp' && !isWebp) return { ok: false, reason: 'magic_mismatch' }
  return {
    ok: true,
    reason: null,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
  }
}

export function resolveLocalImagePath(mediaRootDir, imageFile) {
  const rel = String(imageFile || '').replace(/^\/+/, '')
  if (!rel) return null
  const full = join(mediaRootDir, rel)
  return existsSync(full) ? full : null
}

/**
 * Checkpoint media_id means upload already succeeded; if product still lacks photo_media_id,
 * plan an attach-only job (do not skip and do not re-upload).
 */
export function planPhotoJobs({ products, catalogBySku, checkpoint, mediaRootDir, allowRemoteUrls }) {
  const jobs = []
  for (const p of products) {
    const sku = String(p.sku)
    const src = catalogBySku.get(sku) || {}
    const cp = checkpoint[sku]
    if (p.photo_media_id) {
      jobs.push({ sku, action: 'skip_already_attached', product_id: p.id, media_id: p.photo_media_id })
      continue
    }
    if (cp?.media_id && cp?.linked === true) {
      // Linked according to checkpoint but product row lacks photo — re-attach without upload.
      jobs.push({
        sku,
        action: 'attach_existing',
        product_id: p.id,
        media_id: cp.media_id,
        source: 'checkpoint_linked',
      })
      continue
    }
    if (cp?.media_id) {
      jobs.push({
        sku,
        action: 'attach_existing',
        product_id: p.id,
        media_id: cp.media_id,
        source: 'checkpoint_uploaded',
        sha256: cp.sha256 || null,
      })
      continue
    }
    const localPath = resolveLocalImagePath(mediaRootDir, src.imageFile)
    if (localPath) {
      const ct = contentTypeForExt(extname(localPath))
      jobs.push({
        sku,
        action: 'upload_local',
        product_id: p.id,
        source: 'local',
        path: localPath,
        content_type: ct,
        imageFile: src.imageFile,
        file: basename(localPath),
      })
      continue
    }
    if (allowRemoteUrls && src.imageUrl) {
      jobs.push({
        sku,
        action: 'upload_remote',
        product_id: p.id,
        source: 'remote',
        url: src.imageUrl,
        imageFile: src.imageFile || null,
      })
      continue
    }
    jobs.push({
      sku,
      action: 'skip_no_source',
      product_id: p.id,
      imageFile: src.imageFile || null,
      imageUrl: src.imageUrl || null,
    })
  }
  return jobs
}

export function prevalidateLocalCatalog({ products, catalogBySku, mediaRootDir }) {
  const rows = []
  const bySha = new Map()
  const skuSet = new Set()
  let duplicateSkus = 0
  for (const p of products) {
    const sku = String(p.sku)
    if (skuSet.has(sku)) duplicateSkus += 1
    skuSet.add(sku)
    const src = catalogBySku.get(sku) || {}
    const localPath = resolveLocalImagePath(mediaRootDir, src.imageFile)
    const row = {
      sku,
      product_id: p.id,
      imageFile: src.imageFile || null,
      path: localPath,
      ok: false,
      reason: null,
      sha256: null,
      size: null,
      content_type: null,
      already_has_photo: Boolean(p.photo_media_id),
      photo_media_id: p.photo_media_id || null,
    }
    if (!src.imageFile) {
      row.reason = 'missing_imageFile'
      rows.push(row)
      continue
    }
    if (!localPath) {
      row.reason = 'file_not_found'
      rows.push(row)
      continue
    }
    const ct = contentTypeForExt(extname(localPath))
    row.content_type = ct
    if (!ct) {
      row.reason = 'unsupported_format'
      rows.push(row)
      continue
    }
    let bytes
    try {
      bytes = readFileSync(localPath)
    } catch (err) {
      row.reason = `read_error:${err.message || err}`
      rows.push(row)
      continue
    }
    const v = validateImageCandidate({ bytes, contentType: ct })
    row.ok = v.ok
    row.reason = v.reason
    row.sha256 = v.sha256 || null
    row.size = v.size || bytes.length
    if (v.ok && v.sha256) {
      if (!bySha.has(v.sha256)) bySha.set(v.sha256, [])
      bySha.get(v.sha256).push({ sku, file: basename(localPath), imageFile: src.imageFile })
    }
    rows.push(row)
  }
  const duplicateGroups = [...bySha.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([sha256, list]) => ({ sha256, count: list.length, items: list }))
  return {
    total_products: products.length,
    unique_skus: skuSet.size,
    duplicate_sku_rows: duplicateSkus,
    found_files: rows.filter((r) => r.path).length,
    validated_ok: rows.filter((r) => r.ok).length,
    validated_fail: rows.filter((r) => !r.ok).length,
    already_has_photo: rows.filter((r) => r.already_has_photo).length,
    unique_sha256: bySha.size,
    duplicate_content_groups: duplicateGroups,
    failures: rows.filter((r) => !r.ok),
    rows,
  }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export function backoffMs(attempt, base = 8000, cap = 45000) {
  const ms = Math.min(cap, base * Math.pow(2, Math.max(0, attempt - 1)))
  return ms
}

export function isRetryableStatus(status) {
  return status === 429 || status === 502 || status === 503 || status === 504
}
