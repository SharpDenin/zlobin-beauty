import { API_BASE_URL, ApiError, apiErrorFromResponse, networkApiError } from '@/shared/api/client'

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime'])

export const MEDIA_ACCEPT_IMAGES = 'image/jpeg,image/png,image/webp'
export const MEDIA_ACCEPT_VIDEO = 'video/mp4,video/webm,video/quicktime'
export const MEDIA_ACCEPT_IMAGE_OR_VIDEO = `${MEDIA_ACCEPT_IMAGES},${MEDIA_ACCEPT_VIDEO}`
export const MEDIA_MAX_BYTES_DEFAULT = 5 * 1024 * 1024
export const MEDIA_MAX_VIDEO_BYTES = 50 * 1024 * 1024

export function isVideoFile(file: File): boolean {
  return VIDEO_MIME.has(file.type)
}

export function validateMediaFile(
  file: File,
  opts?: { allowVideo?: boolean; maxImageBytes?: number; maxVideoBytes?: number },
): string | null {
  const allowVideo = opts?.allowVideo ?? false
  const maxImage = opts?.maxImageBytes ?? MEDIA_MAX_BYTES_DEFAULT
  const maxVideo = opts?.maxVideoBytes ?? MEDIA_MAX_VIDEO_BYTES
  if (IMAGE_MIME.has(file.type)) {
    if (file.size > maxImage) {
      return `Файл слишком большой (макс. ${Math.round(maxImage / (1024 * 1024))} МБ)`
    }
    return null
  }
  if (allowVideo && VIDEO_MIME.has(file.type)) {
    if (file.size > maxVideo) {
      return `Видео слишком большое (макс. ${Math.round(maxVideo / (1024 * 1024))} МБ)`
    }
    return null
  }
  return allowVideo
    ? 'Допустимы JPEG, PNG, WebP или видео MP4/WebM'
    : 'Допустимы только JPEG, PNG или WebP'
}

/** @deprecated prefer validateMediaFile */
export function validateImageFile(file: File, maxBytes = MEDIA_MAX_BYTES_DEFAULT): string | null {
  return validateMediaFile(file, { allowVideo: false, maxImageBytes: maxBytes })
}

export type UploadMediaResult = {
  id: string
  mime_type?: string
  content_type?: string
  size_bytes?: number
  purpose?: string
}

export type UploadProgressHandler = (percent: number) => void

export function uploadMedia(
  file: File,
  purpose: string,
  token: string | null | undefined,
  onProgress?: UploadProgressHandler,
  opts?: { allowVideo?: boolean },
): Promise<UploadMediaResult> {
  const allowVideo = opts?.allowVideo || purpose === 'video'
  const mimeError = validateMediaFile(file, { allowVideo })
  if (mimeError) {
    const knownType = IMAGE_MIME.has(file.type) || VIDEO_MIME.has(file.type)
    const code = knownType ? 'media_too_large' : 'media_unsupported_type'
    return Promise.reject(new ApiError(mimeError, code, 400))
  }
  const resolvedPurpose = isVideoFile(file) ? 'video' : purpose

  const form = new FormData()
  form.append('file', file)
  form.append('purpose', resolvedPurpose)

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE_URL}/v1/media`)
    xhr.setRequestHeader('Accept', 'application/json')
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    }

    xhr.upload.onprogress = (ev) => {
      if (!onProgress || !ev.lengthComputable || ev.total <= 0) return
      onProgress(Math.min(100, Math.round((ev.loaded / ev.total) * 100)))
    }

    xhr.onload = () => {
      let data: Record<string, unknown> = {}
      try {
        data = JSON.parse(xhr.responseText || '{}') as Record<string, unknown>
      } catch {
        data = {}
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const id = data.id
        if (typeof id !== 'string' || !id) {
          reject(new ApiError('Не удалось сохранить файл', 'error', xhr.status))
          return
        }
        onProgress?.(100)
        resolve(data as UploadMediaResult)
        return
      }
      reject(apiErrorFromResponse(data, xhr.status))
    }

    xhr.onerror = () => {
      reject(networkApiError())
    }

    xhr.onabort = () => {
      reject(new ApiError('Загрузка отменена', 'aborted', 0))
    }

    xhr.send(form)
  })
}
