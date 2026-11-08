import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_UI_ACCENT, tuneAccentForUi } from '@/shared/theme/accent'
import { extractDominantAccent, extractWallpaperAccent } from '@/shared/theme/extractWallpaperAccent'

type FakeImageData = { data: Uint8ClampedArray; width: number; height: number }

function solidImageData(hex: string, size = 48): FakeImageData {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  const data = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = 255
  }
  return { data, width: size, height: size }
}

function splitImageData(main: string, edge: string, size = 48): FakeImageData {
  const parse = (hex: string) => ({
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  })
  const a = parse(main)
  const e = parse(edge)
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const c = x < size / 4 ? e : a
      data[i] = c.r
      data[i + 1] = c.g
      data[i + 2] = c.b
      data[i + 3] = 255
    }
  }
  return { data, width: size, height: size }
}

function stubCanvasPixels(imageData: FakeImageData) {
  const ctx = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => imageData),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
}

describe('extractWallpaperAccent', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'Image',
      class MockImage {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        crossOrigin = ''
        src = ''
        constructor() {
          Object.defineProperty(this, 'src', {
            set: () => {
              queueMicrotask(() => this.onload?.())
            },
            get: () => 'mock',
          })
        }
      },
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns null for a near-mono dark image', async () => {
    stubCanvasPixels(solidImageData('#121418'))
    await expect(extractDominantAccent('data:image/png;base64,xx')).resolves.toBeNull()
  })

  it('picks a saturated dominant hue from a vivid image', async () => {
    stubCanvasPixels(splitImageData('#2A6BFF', '#1A1F2A'))
    const hex = await extractDominantAccent('blob:mock')
    expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
    expect(hex).not.toBe(DEFAULT_UI_ACCENT)
    const n = Number.parseInt((hex as string).slice(1), 16)
    const r = (n >> 16) & 255
    const b = n & 255
    expect(b).toBeGreaterThan(r)
  })

  it('tunes extracted colors for the active theme', async () => {
    stubCanvasPixels(solidImageData('#FF88AA'))
    const raw = await extractDominantAccent('blob:pink')
    const light = await extractWallpaperAccent('blob:pink', 'light')
    expect(raw).toBeTruthy()
    expect(light).toBe(tuneAccentForUi(raw!, 'light'))
  })

  it('returns null when the image fails to load', async () => {
    vi.stubGlobal(
      'Image',
      class FailImage {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        crossOrigin = ''
        constructor() {
          Object.defineProperty(this, 'src', {
            set: () => {
              queueMicrotask(() => this.onerror?.())
            },
            get: () => 'bad',
          })
        }
      },
    )
    await expect(extractDominantAccent('blob:bad')).resolves.toBeNull()
  })
})
