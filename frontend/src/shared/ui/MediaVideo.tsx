import { useEffect, useRef, useState } from 'react'
import { API_BASE_URL } from '@/shared/api/client'
import { loadSignedMediaUrl } from '@/shared/lib/mediaCache'

type Props = {
  mediaId: string
  className?: string
  title?: string
  /** Fires when the video cannot be played at all (after one automatic retry). */
  onUnavailable?: () => void
  autoPlay?: boolean
  muted?: boolean
  loop?: boolean
}

/**
 * Plays a stored video by streaming it from a short-lived signed URL: the browser issues Range
 * requests itself (required for iOS playback and seeking) and the bearer token never reaches the
 * element. On a playback error (e.g. the 15 minute link expired while paused) it asks for a new
 * link once and resumes from the same position.
 */
export function MediaVideo({ mediaId, className, title, onUnavailable, autoPlay, muted, loop }: Props) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const retried = useRef(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    let cancelled = false
    retried.current = false
    setSrc(null)
    setFailed(false)
    void loadSignedMediaUrl(mediaId, API_BASE_URL).then((url) => {
      if (cancelled) return
      if (url) setSrc(url)
      else {
        setFailed(true)
        onUnavailable?.()
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaId])

  async function onError() {
    if (retried.current) {
      setFailed(true)
      onUnavailable?.()
      return
    }
    retried.current = true
    const resumeAt = videoRef.current?.currentTime ?? 0
    const url = await loadSignedMediaUrl(mediaId, API_BASE_URL)
    if (!url) {
      setFailed(true)
      onUnavailable?.()
      return
    }
    setSrc(url)
    requestAnimationFrame(() => {
      const el = videoRef.current
      if (el && resumeAt > 0) el.currentTime = resumeAt
    })
  }

  if (failed) {
    return <p className="muted media-video-failed">Видео недоступно. Попробуйте обновить страницу.</p>
  }
  if (!src) {
    return <div className={`media-skeleton ${className ?? ''}`.trim()} aria-busy="true" aria-label="Загрузка видео" />
  }
  return (
    <video
      ref={videoRef}
      className={className}
      src={src}
      controls
      playsInline
      preload="metadata"
      title={title}
      autoPlay={autoPlay}
      muted={muted}
      loop={loop}
      onError={() => void onError()}
    />
  )
}
