import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, extname } from 'node:path'

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
    if (cp?.media_id) {
      jobs.push({ sku, action: 'skip_checkpoint_has_media', product_id: p.id, media_id: cp.media_id })
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
