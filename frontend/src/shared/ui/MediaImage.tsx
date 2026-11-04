import { useEffect, useRef, useState } from 'react'
import { getCachedMediaUrl, loadMediaBlobUrl } from '@/shared/lib/mediaCache'
import { getCachedGifStill, resolveGifStillFrame } from '@/shared/lib/gifStillFrame'
import '@/features/media-cards/media-cards.css'

export { clearMediaCache } from '@/shared/lib/mediaCache'

type Props = {
  mediaId?: string | null
  token?: string | null
  alt?: string
  className?: string
  /** Initials or short label shown when media is missing or fails. */
  fallback?: string
  /**
   * cover: layered blur background + object-fit cover (edge-to-edge cards).
   * plain: single img (default).
   */
  variant?: 'plain' | 'cover'
  /** `eager` skips viewport-based lazy loading (above-the-fold hero images). */
  loading?: 'lazy' | 'eager'
  /**
   * Opt-in: freeze the first decoded frame (for portfolio GIF grid/thumbs).
   * Default remains animated. Callers should pass this only when media is a GIF.
   */
  stillFrame?: boolean
}

function useNearViewport(enabled: boolean) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [near, setNear] = useState(!enabled || typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (near || !enabled) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true)
          io.disconnect()
        }
      },
      { rootMargin: '400px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [near, enabled])
  return { ref, near }
}

export function MediaImage({
  mediaId,
  token,
  alt,
  className,
  fallback,
  variant = 'plain',
  loading = 'lazy',
  stillFrame = false,
}: Props) {
  const resolvedId = mediaId?.trim() ?? ''
  const [src, setSrc] = useState<string | null>(() => {
    if (!resolvedId) return null
    if (stillFrame) return getCachedGifStill(resolvedId) ?? null
    return getCachedMediaUrl(resolvedId)
  })
  const [failed, setFailed] = useState(!resolvedId)
  const { ref, near } = useNearViewport(
    loading === 'lazy'
      && Boolean(resolvedId)
      && !(stillFrame ? getCachedGifStill(resolvedId) : getCachedMediaUrl(resolvedId)),
  )

  useEffect(() => {
    if (!resolvedId) {
      setSrc(null)
      setFailed(true)
      return
    }

    let cancelled = false

    const applyBlob = async (blobUrl: string) => {
      if (!stillFrame) {
        if (!cancelled) {
          setSrc(blobUrl)
          setFailed(false)
        }
        return
      }
      const cachedStill = getCachedGifStill(resolvedId)
      if (cachedStill) {
        if (!cancelled) {
          setSrc(cachedStill)
          setFailed(false)
        }
        return
      }
      // Keep skeleton until still is ready to avoid a brief animated flash.
      if (!cancelled) {
        setSrc(null)
        setFailed(false)
      }
      const still = await resolveGifStillFrame(resolvedId, blobUrl)
      if (cancelled) return
      setSrc(still || blobUrl)
      setFailed(false)
    }

    const cachedBlob = getCachedMediaUrl(resolvedId)
    if (cachedBlob) {
      void applyBlob(cachedBlob)
      return () => {
        cancelled = true
      }
    }

    if (!near) return

    setFailed(false)
    setSrc(null)
    void loadMediaBlobUrl(resolvedId).then((url) => {
      if (cancelled) return
      if (!url) {
        setFailed(true)
        return
      }
      void applyBlob(url)
    })

    return () => {
      cancelled = true
    }
    // `token` is a dependency on purpose: a failed private image is retried after the session renews.
  }, [resolvedId, token, near, stillFrame])

  const label = fallback || (alt ? alt.slice(0, 2).toUpperCase() : '')

  if (failed) {
    return (
      <div
        className={`media-fallback ${className ?? ''}`.trim()}
        role="img"
        aria-label={alt || 'Нет изображения'}
        data-still-frame={stillFrame ? 'true' : undefined}
      >
        {label || '—'}
      </div>
    )
  }
  if (!src) {
    return (
      <div
        ref={ref}
        className={`media-skeleton ${className ?? ''}`.trim()}
        aria-busy="true"
        aria-label="Загрузка изображения"
        data-still-frame={stillFrame ? 'true' : undefined}
      />
    )
  }
  if (variant === 'cover') {
    return (
      <div
        className={`edge-media ${className ?? ''}`.trim()}
        data-still-frame={stillFrame ? 'true' : undefined}
        data-testid={stillFrame ? 'media-still-cover' : undefined}
      >
        <img className="edge-media__blur" src={src} alt="" aria-hidden="true" />
        <img className="edge-media__cover" src={src} alt={alt ?? ''} decoding="async" />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={alt ?? ''}
      className={className}
      decoding="async"
      data-still-frame={stillFrame ? 'true' : undefined}
      data-testid={stillFrame ? 'media-still' : undefined}
    />
  )
}
