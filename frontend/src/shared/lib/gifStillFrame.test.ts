import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearGifStillCache,
  extractGifStillFrame,
  getCachedGifStill,
  isPortfolioGif,
  resolveGifStillFrame,
} from '@/shared/lib/gifStillFrame'

afterEach(() => {
  clearGifStillCache()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('isPortfolioGif', () => {
  it('matches gif media_type case-insensitively', () => {
    expect(isPortfolioGif('gif')).toBe(true)
    expect(isPortfolioGif('GIF')).toBe(true)
    expect(isPortfolioGif('photo')).toBe(false)
    expect(isPortfolioGif('video')).toBe(false)
    expect(isPortfolioGif(null)).toBe(false)
  })
})

function stubImage(opts: { fail?: boolean; width?: number; height?: number } = {}) {
  const width = opts.width ?? 4
  const height = opts.height ?? 4
  vi.stubGlobal(
    'Image',
    class {
      onload: ((this: HTMLImageElement, ev: Event) => unknown) | null = null
      onerror: ((this: HTMLImageElement, ev: Event) => unknown) | null = null
      naturalWidth = width
      naturalHeight = height
      width = width
      height = height
      set src(_v: string) {
        queueMicrotask(() => {
          if (opts.fail) this.onerror?.call(this as unknown as HTMLImageElement, new Event('error'))
          else this.onload?.call(this as unknown as HTMLImageElement, new Event('load'))
        })
      }
    },
  )
}

describe('extractGifStillFrame', () => {
  it('returns a png data url for a decodable image', async () => {
    stubImage()
    const toDataURL = vi.fn(() => 'data:image/png;base64,ABC')
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(toDataURL)

    const still = await extractGifStillFrame('blob:mock/gif')
    expect(still).toBe('data:image/png;base64,ABC')
    expect(drawImage).toHaveBeenCalled()
  })

  it('returns null when image fails to load', async () => {
    stubImage({ fail: true })
    const still = await extractGifStillFrame('blob:mock/missing', 200)
    expect(still).toBeNull()
  })

  it('returns null when canvas context is unavailable', async () => {
    stubImage()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const still = await extractGifStillFrame('blob:mock/gif')
    expect(still).toBeNull()
  })
})

describe('resolveGifStillFrame', () => {
  it('caches successful stills per media id', async () => {
    stubImage()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,ONE')

    const a = await resolveGifStillFrame('media-1', 'blob:a')
    const b = await resolveGifStillFrame('media-1', 'blob:a')
    expect(a).toBe('data:image/png;base64,ONE')
    expect(b).toBe(a)
    expect(getCachedGifStill('media-1')).toBe(a)
  })

  it('keeps stills independent across media ids', async () => {
    stubImage()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    const toDataURL = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValueOnce('data:image/png;base64,A')
      .mockReturnValueOnce('data:image/png;base64,B')

    const s1 = await resolveGifStillFrame('a', 'blob:a')
    const s2 = await resolveGifStillFrame('b', 'blob:b')
    expect(s1).toBe('data:image/png;base64,A')
    expect(s2).toBe('data:image/png;base64,B')
    expect(toDataURL).toHaveBeenCalledTimes(2)
  })
})
