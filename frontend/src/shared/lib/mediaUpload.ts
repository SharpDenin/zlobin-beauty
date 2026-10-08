import { API_BASE_URL, ApiError, apiErrorFromResponse, getFreshAccessToken, networkApiError, refreshAccessToken } from '@/shared/api/client'

/**
 * The one place that uploads files. Responsibilities:
 *  - classify the file (photo / GIF / video) and reject unsupported types with a clear error;
 *  - shrink camera photos in the browser (phones produce 4-12 MB JPEGs that slow networks, reverse
 *    proxies with a 1 MB default and size limits choke on);
 *  - send with a FRESH access token and retry once after a refresh (access tokens live 15 minutes);
 *  - turn every failure (size, type, network, stalled upload, expired session) into an ApiError that
 *    the UI already knows how to explain in Russian.
 */

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const GIF_MIME = 'image/gif'
const VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime'])
const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
}

export const MEDIA_ACCEPT_IMAGES = 'image/jpeg,image/png,image/webp'
export const MEDIA_ACCEPT_IMAGES_GIF = `${MEDIA_ACCEPT_IMAGES},image/gif`
export const MEDIA_ACCEPT_VIDEO = 'video/mp4,video/webm,video/quicktime'
export const MEDIA_ACCEPT_IMAGE_OR_VIDEO = `${MEDIA_ACCEPT_IMAGES},${MEDIA_ACCEPT_VIDEO}`
export const MEDIA_ACCEPT_ANY_VISUAL = `${MEDIA_ACCEPT_IMAGES_GIF},${MEDIA_ACCEPT_VIDEO}`

/** Mirrors backend `domain.MaxUploadBytes` / `MaxVideoUploadBytes`. */
export const MEDIA_MAX_BYTES_DEFAULT = 10 * 1024 * 1024
export const MEDIA_MAX_VIDEO_BYTES = 50 * 1024 * 1024

const COMPRESS_THRESHOLD_BYTES = 1.2 * 1024 * 1024
const MAX_EDGE_PX = 2560
const JPEG_QUALITY = 0.85
const STALL_TIMEOUT_MS = 60_000

export type MediaKind = 'image' | 'gif' | 'video'

/** Browsers disagree about `file.type` (empty for some Android/Windows files): fall back to the extension. */
export function detectMime(file: Pick<File, 'type' | 'name'>): string {
  const declared = (file.type || '').toLowerCase()
  if (declared && declared !== 'application/octet-stream') return declared === 'image/jpg' ? 'image/jpeg' : declared
  const ext = file.name?.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TO_MIME[ext] ?? declared
}

export function mediaKindOf(file: Pick<File, 'type' | 'name'>): MediaKind | null {
  const mime = detectMime(file)
  if (IMAGE_MIME.has(mime)) return 'image'
  if (mime === GIF_MIME) return 'gif'
  if (VIDEO_MIME.has(mime)) return 'video'
  return null
}

export function isVideoFile(file: Pick<File, 'type' | 'name'>): boolean {
  return mediaKindOf(file) === 'video'
}

export type MediaValidationOptions = {
  allowVideo?: boolean
  allowGif?: boolean
  maxImageBytes?: number
  maxVideoBytes?: number
}

const mb = (bytes: number) => Math.round(bytes / (1024 * 1024))

export function mediaFileApiError(file: File, opts?: MediaValidationOptions): ApiError | null {
  if (!file || file.size === 0) {
    return new ApiError('empty file', 'media_empty', 400)
  }
  const kind = mediaKindOf(file)
  const allowGif = opts?.allowGif ?? true
  if (!kind || (kind === 'video' && !opts?.allowVideo) || (kind === 'gif' && !allowGif)) {
    return new ApiError(unsupportedMessage(opts), 'media_unsupported_type', 400)
  }
  if (kind === 'video') {
    const max = opts?.maxVideoBytes ?? MEDIA_MAX_VIDEO_BYTES
    if (file.size > max) return tooLarge(`Видео слишком большое (макс. ${mb(max)} МБ)`, max)
    return null
  }
  // Static photos are shrunk before sending, so only reject absurd originals here; GIF is sent as is.
  const max = opts?.maxImageBytes ?? MEDIA_MAX_BYTES_DEFAULT
  if (kind === 'gif' && file.size > max) return tooLarge(`GIF слишком большой (макс. ${mb(max)} МБ)`, max)
  if (kind === 'image' && file.size > 60 * 1024 * 1024) return tooLarge('Фотография слишком большая', max)
  return null
}

function unsupportedMessage(opts?: MediaValidationOptions): string {
  return opts?.allowVideo
    ? 'Допустимы фото JPEG, PNG, WebP, GIF или видео MP4, WebM, MOV'
    : 'Допустимы только JPEG, PNG, WebP или GIF'
}

function tooLarge(message: string, maxBytes: number): ApiError {
  return new ApiError(message, 'media_too_large', 400, { details: { max_bytes: maxBytes } })
}

/** @deprecated kept for older call sites: returns the validation message or null. */
export function validateMediaFile(file: File, opts?: MediaValidationOptions): string | null {
  return mediaFileApiError(file, opts)?.message ?? null
}

/** @deprecated prefer validateMediaFile */
export function validateImageFile(file: File, maxBytes = MEDIA_MAX_BYTES_DEFAULT): string | null {
  return validateMediaFile(file, { allowVideo: false, maxImageBytes: maxBytes })
}

// --- photo preparation --------------------------------------------------------------------

type ImageSource = { width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; close?: () => void }

async function decodeImage(file: Blob): Promise<ImageSource> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
      return { width: bmp.width, height: bmp.height, draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h), close: () => bmp.close() }
    } catch {
      /* fall through to <img> decoding */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('decode failed'))
      el.src = url
    })
    return { width: img.naturalWidth, height: img.naturalHeight, draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h) }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality))
}

export function scaledSize(width: number, height: number, maxEdge = MAX_EDGE_PX): { width: number; height: number } {
  const long = Math.max(width, height)
  if (long <= maxEdge) return { width, height }
  const k = maxEdge / long
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) }
}

export function shouldCompress(file: Pick<File, 'size' | 'type' | 'name'>): boolean {
  return mediaKindOf(file) === 'image' && file.size > COMPRESS_THRESHOLD_BYTES
}

/**
 * Re-encodes a large photo as a right-sized JPEG (EXIF orientation applied). Returns the original
 * file when the browser cannot decode/encode it or when re-encoding would not help.
 */
export async function prepareImageForUpload(file: File): Promise<File> {
  if (!shouldCompress(file) || typeof document === 'undefined') return file
  let source: ImageSource | null = null
  try {
    source = await decodeImage(file)
    let edge = MAX_EDGE_PX
    let quality = JPEG_QUALITY
    let best: Blob | null = null
    for (let attempt = 0; attempt < 4; attempt++) {
      const { width, height } = scaledSize(source.width, source.height, edge)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return file
      ctx.fillStyle = '#fff' // JPEG has no alpha: flatten transparent PNGs on white instead of black
      ctx.fillRect(0, 0, width, height)
      source.draw(ctx, width, height)
      best = await canvasToBlob(canvas, 'image/jpeg', quality)
      if (!best) return file
      if (best.size <= 4 * 1024 * 1024) break
      edge = Math.round(edge * 0.75)
      quality = Math.max(0.6, quality - 0.1)
    }
    if (!best || best.size >= file.size) return file
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo'
    return new File([best], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    return file // undecodable here (e.g. HEIC on desktop Chrome): the server answers with a typed error
  } finally {
    source?.close?.()
  }
}

// --- upload -------------------------------------------------------------------------------

export type UploadMediaResult = {
  id: string
  mime_type?: string
  content_type?: string
  size_bytes?: number
  purpose?: string
  width?: number
  height?: number
}

export type UploadProgressHandler = (percent: number) => void

type XhrOutcome = { status: number; data: Record<string, unknown> }

function sendForm(form: FormData, token: string | null, onProgress?: UploadProgressHandler): Promise<XhrOutcome> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE_URL}/v1/media`)
    xhr.setRequestHeader('Accept', 'application/json')
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.timeout = 0 // slow mobile links legitimately need minutes; we watch for stalls instead

    let lastActivity = Date.now()
    let stalled = false
    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity > STALL_TIMEOUT_MS) {
        stalled = true
        xhr.abort()
      }
    }, 5_000)
    const finish = () => clearInterval(watchdog)

    xhr.upload.onprogress = (ev) => {
      lastActivity = Date.now()
      if (!onProgress || !ev.lengthComputable || ev.total <= 0) return
      onProgress(Math.min(99, Math.round((ev.loaded / ev.total) * 100)))
    }
    xhr.onload = () => {
      finish()
      let data: Record<string, unknown> = {}
      try {
        data = JSON.parse(xhr.responseText || '{}') as Record<string, unknown>
      } catch {
        data = {}
      }
      resolve({ status: xhr.status, data })
    }
    xhr.onerror = () => {
      finish()
      reject(networkApiError())
    }
    xhr.onabort = () => {
      finish()
      reject(stalled ? new ApiError('upload stalled', 'upload_stalled', 0) : new ApiError('Загрузка отменена', 'aborted', 0))
    }
    xhr.send(form)
  })
}

function failureFor(outcome: XhrOutcome): ApiError {
  const { status, data } = outcome
  const hasEnvelope = typeof (data as { error?: unknown }).error === 'object'
  if (!hasEnvelope) {
    // Proxy/edge answers without our JSON envelope (e.g. nginx 413 "Request Entity Too Large").
    if (status === 413) return new ApiError('payload too large', 'media_too_large', 413)
    if (status === 502 || status === 503 || status === 504) return new ApiError('unavailable', 'upstream_unavailable', status)
  }
  return apiErrorFromResponse(data, status)
}

export async function uploadMedia(
  file: File,
  purpose: string,
  token: string | null | undefined,
  onProgress?: UploadProgressHandler,
  opts?: { allowVideo?: boolean; allowGif?: boolean; preservePurpose?: boolean; compress?: boolean },
): Promise<UploadMediaResult> {
  const allowVideo = opts?.allowVideo || purpose === 'video' || purpose === 'message'
  const invalid = mediaFileApiError(file, { allowVideo, allowGif: opts?.allowGif ?? true })
  if (invalid) throw invalid

  const kind = mediaKindOf(file)
  let payload: File = file
  if (opts?.compress !== false && kind === 'image') {
    onProgress?.(1)
    payload = await prepareImageForUpload(file)
  }
  // After preparation the photo must fit the server ceiling.
  const afterPrep = mediaFileApiError(payload, { allowVideo, allowGif: opts?.allowGif ?? true })
  if (afterPrep) throw afterPrep
  if (kind === 'image' && payload.size > MEDIA_MAX_BYTES_DEFAULT) {
    throw tooLarge(`Файл слишком большой (макс. ${mb(MEDIA_MAX_BYTES_DEFAULT)} МБ)`, MEDIA_MAX_BYTES_DEFAULT)
  }

  const resolvedPurpose = opts?.preservePurpose || purpose === 'message' ? purpose : kind === 'video' ? 'video' : purpose
  const form = new FormData()
  form.append('purpose', resolvedPurpose)
  // Declare the detected type: some browsers leave `file.type` empty.
  const declared = detectMime(payload)
  form.append('file', payload.type === declared ? payload : new File([payload], payload.name, { type: declared }), payload.name)

  // The token held by a component can be minutes old; always send a fresh one.
  let bearer = (await getFreshAccessToken()) ?? token ?? null
  let outcome = await sendForm(form, bearer, onProgress)
  if (outcome.status === 401) {
    let next: string | null = null
    try {
      next = await refreshAccessToken(bearer ?? undefined)
    } catch {
      next = null
    }
    if (next && next !== bearer) {
      bearer = next
      outcome = await sendForm(form, bearer, onProgress)
    }
  }
  if (outcome.status >= 200 && outcome.status < 300) {
    const id = outcome.data.id
    if (typeof id !== 'string' || !id) throw new ApiError('Не удалось сохранить файл', 'error', outcome.status)
    onProgress?.(100)
    return outcome.data as UploadMediaResult
  }
  throw failureFor(outcome)
}
