import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cropAspectForPurpose,
  getCroppedImageFile,
  shouldOpenImageCrop,
} from '@/shared/lib/imageCrop'

describe('cropAspectForPurpose', () => {
  it('keeps display-aligned ratios for framed surfaces', () => {
    expect(cropAspectForPurpose('profile')).toBe(1)
    expect(cropAspectForPurpose('service')).toBeCloseTo(16 / 9)
    expect(cropAspectForPurpose('salon')).toBeCloseTo(16 / 9)
    expect(cropAspectForPurpose('article')).toBeCloseTo(16 / 9)
    expect(cropAspectForPurpose('product')).toBeCloseTo(4 / 5)
    expect(cropAspectForPurpose('wallpaper')).toBeCloseTo(16 / 10)
  })

  it('does not force a ratio for free-form purposes', () => {
    expect(cropAspectForPurpose('portfolio')).toBeNull()
    expect(cropAspectForPurpose('message')).toBeNull()
    expect(cropAspectForPurpose('hair_consultation')).toBeNull()
    expect(cropAspectForPurpose('before_after')).toBeNull()
  })
})

describe('shouldOpenImageCrop', () => {
  it('opens only for static raster photos', () => {
    expect(shouldOpenImageCrop(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))).toBe(true)
    expect(shouldOpenImageCrop(new File(['x'], 'a.png', { type: 'image/png' }))).toBe(true)
    expect(shouldOpenImageCrop(new File(['x'], 'a.webp', { type: 'image/webp' }))).toBe(true)
    expect(shouldOpenImageCrop(new File(['x'], 'a.gif', { type: 'image/gif' }))).toBe(false)
    expect(shouldOpenImageCrop(new File(['x'], 'a.mp4', { type: 'video/mp4' }))).toBe(false)
  })
})

describe('getCroppedImageFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('draws the pixel crop into a JPEG File', async () => {
    const drawImage = vi.fn()
    const fillRect = vi.fn()
    const ctx = {
      fillStyle: '',
      fillRect,
      drawImage,
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
      toBlob: (cb: BlobCallback) => {
        cb(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }))
      },
    }
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') return canvas as unknown as HTMLCanvasElement
      return document.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElement
    })

    const bitmap = {
      width: 200,
      height: 100,
      close: vi.fn(),
    }
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        blob: async () => new Blob([new Uint8Array(8)], { type: 'image/jpeg' }),
      })),
    )

    const file = await getCroppedImageFile(
      'blob:test',
      { x: 10, y: 20, width: 80, height: 40 },
      'shot.png',
    )

    expect(file).toBeInstanceOf(File)
    expect(file.type).toBe('image/jpeg')
    expect(file.name).toBe('shot.jpg')
    expect(canvas.width).toBe(80)
    expect(canvas.height).toBe(40)
    expect(drawImage).toHaveBeenCalledWith(bitmap, 10, 20, 80, 40, 0, 0, 80, 40)
    expect(bitmap.close).toHaveBeenCalled()
  })
})
