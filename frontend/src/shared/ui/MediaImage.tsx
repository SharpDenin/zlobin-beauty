import { useEffect, useState } from 'react'
import { API_BASE_URL } from '@/shared/api/client'

type Props = {
  mediaId: string
  token?: string | null
  alt?: string
  className?: string
}

export function MediaImage({ mediaId, token, alt, className }: Props) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!mediaId) {
      setSrc(null)
      setFailed(false)
      return
    }
    let cancelled = false
    let objectUrl: string | null = null
    setFailed(false)
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

  if (failed) {
    return <div className="state-box">Не удалось загрузить изображение</div>
  }
  if (!src) {
    return <div className="state-box">Загрузка…</div>
  }
  return <img src={src} alt={alt ?? ''} className={className} />
}
