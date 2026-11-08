import { mediaKindOf } from '@/shared/lib/mediaUpload'

/** Pixel crop rectangle from react-easy-crop (natural image coordinates). */
export type CropPixelArea = {
  x: number
  y: number
  width: number
  height: number
}

export const CROP_MIN_ZOOM = 1
export const CROP_MAX_ZOOM = 4
export const CROP_ZOOM_STEP = 0.01

/**
 * Aspect hints aligned with how photos are framed in the UI (object-fit cover).
 * `null` = keep the source image aspect (zoom/pan only; no forced ratio).
 */
export function cropAspectForPurpose(purpose: string): number | null {
  switch (purpose) {
    case 'profile':
      return 1
    case 'service':
      return 16 / 9
    case 'salon':
      return 16 / 9
    case 'article':
      return 16 / 9
    case 'product':
      return 4 / 5
    case 'wallpaper':
      return 16 / 10
    default:
      // portfolio, message, hair_consultation, before_after, …
      return null
  }
}

/** Static raster photos go through the editor; GIF/video keep their original pipeline. */
export function shouldOpenImageCrop(file: Pick<File, 'type' | 'name'>): boolean {
  return mediaKindOf(file) === 'image'
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality))
}

async function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('crop_decode_failed'))
    img.src = src
  })
}

/**
 * Renders the cropped region at full crop-pixel resolution (EXIF already applied by the
 * browser when the object URL / bitmap was created for the editor). Prefer JPEG for upload
 * compatibility; fall back to PNG when JPEG encoding is unavailable.
 */
export async function getCroppedImageFile(
  imageSrc: string,
  pixelCrop: CropPixelArea,
  fileName = 'photo.jpg',
  opts?: { mimeType?: string; quality?: number; maxEdge?: number },
): Promise<File> {
  const mimeType = opts?.mimeType ?? 'image/jpeg'
  const quality = opts?.quality ?? 0.92
  const maxEdge = opts?.maxEdge ?? 4096

  if (!pixelCrop.width || !pixelCrop.height) {
    throw new Error('crop_empty')
  }

  let bitmap: ImageBitmap | null = null
  let sourceW = 0
  let sourceH = 0
  let drawSource: CanvasImageSource | null = null

  try {
    if (typeof createImageBitmap === 'function') {
      try {
        const res = await fetch(imageSrc)
        const blob = await res.blob()
        bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions)
        sourceW = bitmap.width
        sourceH = bitmap.height
        drawSource = bitmap
      } catch {
        bitmap = null
      }
    }
    if (!drawSource) {
      const img = await loadImageElement(imageSrc)
      sourceW = img.naturalWidth
      sourceH = img.naturalHeight
      drawSource = img
    }
    const source = drawSource

    const sx = Math.max(0, Math.min(sourceW, Math.round(pixelCrop.x)))
    const sy = Math.max(0, Math.min(sourceH, Math.round(pixelCrop.y)))
    const sw = Math.max(1, Math.min(sourceW - sx, Math.round(pixelCrop.width)))
    const sh = Math.max(1, Math.min(sourceH - sy, Math.round(pixelCrop.height)))

    let outW = sw
    let outH = sh
    const long = Math.max(outW, outH)
    if (long > maxEdge) {
      const k = maxEdge / long
      outW = Math.max(1, Math.round(outW * k))
      outH = Math.max(1, Math.round(outH * k))
    }

    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('crop_canvas')

    if (mimeType === 'image/jpeg') {
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, outW, outH)
    }
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outW, outH)

    let blob = await canvasToBlob(canvas, mimeType, quality)
    if (!blob && mimeType !== 'image/png') {
      blob = await canvasToBlob(canvas, 'image/png', 1)
    }
    if (!blob) throw new Error('crop_encode')

    const base = fileName.replace(/\.[^.]+$/, '') || 'photo'
    const ext = blob.type === 'image/png' ? 'png' : 'jpg'
    return new File([blob], `${base}.${ext}`, { type: blob.type, lastModified: Date.now() })
  } finally {
    bitmap?.close()
  }
}
