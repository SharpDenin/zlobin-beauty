import { useEffect, useState } from 'react'
import { API_BASE_URL } from '@/shared/api/client'

type Props = {
  mediaId: string
  token?: string | null
  alt?: string
  className?: string
  /** Initials or short label shown when media is missing or fails. */
  fallback?: string
}

export function MediaImage({ mediaId, token, alt, className, fallback }: Props) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!mediaId) {
      setSrc(null)
      setFailed(true)
      return
    }
    let cancelled = false
    let objectUrl: string | null = null
    setFailed(false)
    setSrc(null)
    const headers: HeadersInit = {}
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
    void fetch(`${API_BASE_URL}/v1/media/${mediaId}/content`, { headers }).then(async (res) => {
      if (!res.ok || cancelled) {
        if (!cancelled) setFailed(true)
        return
      }
      const blob = await res.blob()
      objectUrl = URL.createObjectURL(blob)
      if (!cancelled) setSrc(objectUrl)
    }).catch(() => {
      if (!cancelled) setFailed(true)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [mediaId, token])

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
    return <div className={`media-skeleton ${className ?? ''}`.trim()} aria-busy="true" aria-label="Загрузка изображения" />
  }
  return <img src={src} alt={alt ?? ''} className={className} />
}
