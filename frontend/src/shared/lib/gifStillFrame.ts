/** In-memory still frames derived from GIF blob URLs (keyed by media id). */
const stillByMediaId = new Map<string, string>()

export function getCachedGifStill(mediaId: string): string | null {
  return stillByMediaId.get(mediaId) ?? null
}

export function clearGifStillCache() {
  stillByMediaId.clear()
}

/**
 * Draws the first decoded frame of an image URL onto a canvas and returns a PNG data URL.
 * Returns null when canvas/decode is unavailable or fails — callers should fall back to the original URL.
 */
export function extractGifStillFrame(sourceUrl: string, timeoutMs = 8_000): Promise<string | null> {
  if (typeof document === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      resolve(value)
    }
    const timer = window.setTimeout(() => finish(null), timeoutMs)
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width
        const h = img.naturalHeight || img.height
        if (!w || !h) {
          finish(null)
          return
        }
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          finish(null)
          return
        }
        ctx.drawImage(img, 0, 0)
        finish(canvas.toDataURL('image/png'))
      } catch {
        finish(null)
      }
    }
    img.onerror = () => finish(null)
    img.src = sourceUrl
  })
}

/** Resolves a static preview URL for a GIF media id, caching successful stills in memory. */
export async function resolveGifStillFrame(mediaId: string, blobUrl: string): Promise<string | null> {
  const hit = stillByMediaId.get(mediaId)
  if (hit) return hit
  const still = await extractGifStillFrame(blobUrl)
  if (still) stillByMediaId.set(mediaId, still)
  return still
}

export function isPortfolioGif(mediaType?: string | null): boolean {
  return (mediaType ?? '').trim().toLowerCase() === 'gif'
}
