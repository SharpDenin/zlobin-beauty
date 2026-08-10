import { API_BASE_URL, ApiError } from '@/shared/api/client'

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

export const MEDIA_ACCEPT_IMAGES = 'image/jpeg,image/png,image/webp'
export const MEDIA_MAX_BYTES_DEFAULT = 5 * 1024 * 1024

export function validateImageFile(file: File, maxBytes = MEDIA_MAX_BYTES_DEFAULT): string | null {
  if (!ALLOWED_MIME.has(file.type)) {
    return 'Допустимы только JPEG, PNG или WebP'
  }
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024))
    return `Файл слишком большой (макс. ${mb} МБ)`
  }
  return null
}

export type UploadMediaResult = {
  id: string
  mime_type?: string
  size_bytes?: number
  purpose?: string
}

export type UploadProgressHandler = (percent: number) => void

export function uploadMedia(
  file: File,
  purpose: string,
  token: string | null | undefined,
  onProgress?: UploadProgressHandler,
): Promise<UploadMediaResult> {
  const mimeError = validateImageFile(file)
  if (mimeError) {
    return Promise.reject(new ApiError(mimeError, 'validation_error', 400))
  }

  const form = new FormData()
  form.append('file', file)
  form.append('purpose', purpose)

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
          reject(new ApiError('Сервер не вернул id медиа', 'error', xhr.status))
          return
        }
        onProgress?.(100)
        resolve(data as UploadMediaResult)
        return
      }
      const err = data.error as { message?: string; code?: string } | undefined
      reject(new ApiError(
        err?.message ?? 'Не удалось загрузить файл',
        err?.code ?? 'error',
        xhr.status,
      ))
    }

    xhr.onerror = () => {
      reject(new ApiError('Сеть недоступна. Проверьте соединение', 'network_error', 0))
    }

    xhr.onabort = () => {
      reject(new ApiError('Загрузка отменена', 'aborted', 0))
    }

    xhr.send(form)
  })
}
