import { useEffect, useRef, useState } from 'react'
import { getCachedMediaUrl, loadMediaBlobUrl } from '@/shared/lib/mediaCache'
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

export function MediaImage({ mediaId, token, alt, className, fallback, variant = 'plain', loading = 'lazy' }: Props) {
  const resolvedId = mediaId?.trim() ?? ''
  const [src, setSrc] = useState<string | null>(() => (resolvedId ? getCachedMediaUrl(resolvedId) : null))
  const [failed, setFailed] = useState(!resolvedId)
  const { ref, near } = useNearViewport(loading === 'lazy' && Boolean(resolvedId) && !getCachedMediaUrl(resolvedId))

  useEffect(() => {
    if (!resolvedId) {
      setSrc(null)
      setFailed(true)
      return
    }
    const cached = getCachedMediaUrl(resolvedId)
    if (cached) {
      setSrc(cached)
      setFailed(false)
      return
    }
    if (!near) return
    let cancelled = false
    setFailed(false)
    setSrc(null)
    void loadMediaBlobUrl(resolvedId).then((url) => {
      if (cancelled) return
      if (url) setSrc(url)
      else setFailed(true)
    })
    return () => {
      cancelled = true
    }
    // `token` is a dependency on purpose: a failed private image is retried after the session renews.
  }, [resolvedId, token, near])

  const label = fallback || (alt ? alt.slice(0, 2).toUpperCase() : '')

  if (failed) {
    return (
      <div
        className={`media-fallback ${className ?? ''}`.trim()}
        role="img"
        aria-label={alt || 'Нет изображения'}
      >
        {label || '—'}
      </div>
    )
  }
  if (!src) {
    return <div ref={ref} className={`media-skeleton ${className ?? ''}`.trim()} aria-busy="true" aria-label="Загрузка изображения" />
  }
  if (variant === 'cover') {
    return (
      <div className={`edge-media ${className ?? ''}`.trim()}>
        <img className="edge-media__blur" src={src} alt="" aria-hidden="true" />
        <img className="edge-media__cover" src={src} alt={alt ?? ''} decoding="async" />
      </div>
    )
  }
  return <img src={src} alt={alt ?? ''} className={className} decoding="async" />
}
