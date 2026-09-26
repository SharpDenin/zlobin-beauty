import { useEffect, useState } from 'react'
import { API_BASE_URL } from '@/shared/api/client'

type Props = {
  mediaId: string
  token?: string | null
  kind: 'image' | 'video' | string
  alt?: string
  onOpenImage?: () => void
}

export function ChatMedia({ mediaId, token, kind, alt, onOpenImage }: Props) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [unsupported, setUnsupported] = useState(false)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setFailed(false)
    setUnsupported(false)
    setSrc(null)
    const headers: HeadersInit = {}
    if (token) headers.Authorization = `Bearer ${token}`
    void fetch(`${API_BASE_URL}/v1/media/${mediaId}/content`, { headers })
      .then(async (res) => {
        if (!res.ok || cancelled) {
          if (!cancelled) setFailed(true)
          return
        }
        const blob = await res.blob()
        objectUrl = URL.createObjectURL(blob)
        if (!cancelled) setSrc(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [mediaId, token])

  if (failed) {
    return <p className="muted">Не удалось загрузить вложение</p>
  }
  if (!src) {
    return <div className="media-skeleton chat-media-skel" aria-busy="true" aria-label="Загрузка вложения" />
  }
  if (kind === 'video') {
    return (
      <div className="chat-media-video">
        {unsupported ? (
          <p>Это видео не удалось воспроизвести. Попробуйте открыть на другом устройстве или попросите отправить MP4 или WebM.</p>
        ) : (
          <video
            src={src}
            controls
            playsInline
            preload="metadata"
            onError={() => setUnsupported(true)}
            aria-label={alt || 'Видео'}
          />
        )}
      </div>
    )
  }
  return (
    <button type="button" className="chat-media-image" onClick={onOpenImage} aria-label={alt || 'Открыть изображение'}>
      <img src={src} alt={alt || ''} />
    </button>
  )
}
