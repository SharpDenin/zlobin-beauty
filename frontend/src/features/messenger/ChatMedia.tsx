import { useEffect, useState } from 'react'
import { getCachedMediaUrl, loadMediaBlobUrl } from '@/shared/lib/mediaCache'
import { MediaVideo } from '@/shared/ui/MediaVideo'

type Props = {
  mediaId: string
  /** Kept for call-site compatibility; requests always use the live session token. */
  token?: string | null
  kind: 'image' | 'video' | string
  alt?: string
  onOpenImage?: () => void
}

export function ChatMedia({ mediaId, token, kind, alt, onOpenImage }: Props) {
  const isVideo = kind === 'video'
  const [src, setSrc] = useState<string | null>(() => (isVideo ? null : getCachedMediaUrl(mediaId)))
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (isVideo) return
    let cancelled = false
    setFailed(false)
    const cached = getCachedMediaUrl(mediaId)
    if (cached) {
      setSrc(cached)
      return
    }
    setSrc(null)
    void loadMediaBlobUrl(mediaId).then((url) => {
      if (cancelled) return
      if (url) setSrc(url)
      else setFailed(true)
    })
    return () => {
      cancelled = true
    }
    // `token` retriggers a retry after the session is renewed.
  }, [mediaId, token, isVideo])

  if (isVideo) {
    return (
      <div className="chat-media-video">
        <MediaVideo mediaId={mediaId} title={alt || 'Видео'} />
      </div>
    )
  }
  if (failed) {
    return <p className="muted">Не удалось загрузить вложение</p>
  }
  if (!src) {
    return <div className="media-skeleton chat-media-skel" aria-busy="true" aria-label="Загрузка вложения" />
  }
  return (
    <button type="button" className="chat-media-image" onClick={onOpenImage} aria-label={alt || 'Открыть изображение'}>
      <img src={src} alt={alt || ''} decoding="async" />
    </button>
  )
}
