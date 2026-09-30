import { authedFetch } from '@/shared/api/client'

/**
 * Media ids are immutable, so a fetched image is reused by every component instead of being
 * downloaded again on each mount (lists, tabs, lightboxes). Private images are dropped when the
 * session changes (`clearMediaCache`, called by AuthProvider).
 */
const MAX_CACHED = 400
const blobUrls = new Map<string, string>()
const inflight = new Map<string, Promise<string | null>>()

export function clearMediaCache() {
  for (const url of blobUrls.values()) URL.revokeObjectURL(url)
  blobUrls.clear()
  inflight.clear()
}

export function getCachedMediaUrl(id: string): string | null {
  return blobUrls.get(id) ?? null
}

function remember(id: string, url: string) {
  blobUrls.set(id, url)
  if (blobUrls.size > MAX_CACHED) {
    const oldest = blobUrls.keys().next().value
    if (oldest !== undefined) blobUrls.delete(oldest) // not revoked: it may still be on screen
  }
}

/** Resolves a displayable object URL for a media id, or null if it cannot be loaded. */
export function loadMediaBlobUrl(id: string): Promise<string | null> {
  const hit = blobUrls.get(id)
  if (hit) return Promise.resolve(hit)
  const pending = inflight.get(id)
  if (pending) return pending
  const task = (async () => {
    try {
      const res = await authedFetch(`/v1/media/${id}/content`)
      if (!res.ok) return null
      const url = URL.createObjectURL(await res.blob())
      remember(id, url)
      return url
    } catch {
      return null
    } finally {
      inflight.delete(id)
    }
  })()
  inflight.set(id, task)
  return task
}

/**
 * Short-lived signed URL for streaming media (video with Range support, large files) without
 * exposing the bearer token to the element. Returns an absolute URL or null.
 */
export async function loadSignedMediaUrl(id: string, apiBase: string): Promise<string | null> {
  try {
    const res = await authedFetch(`/v1/media/${id}/url`)
    if (!res.ok) return null
    const data = (await res.json()) as { url?: string }
    return data.url ? `${apiBase}${data.url}` : null
  } catch {
    return null
  }
}
