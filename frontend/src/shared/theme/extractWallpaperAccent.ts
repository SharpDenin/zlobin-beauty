import {
  DEFAULT_UI_ACCENT,
  toHex,
  tuneAccentForUi,
  type AccentTheme,
  type Rgb,
} from '@/shared/theme/accent'

export { DEFAULT_UI_ACCENT, tuneAccentForUi }

type Hsl = { h: number; s: number; l: number }

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6
  return { h, s, l }
}

function needsCors(url: string): boolean {
  if (url.startsWith('blob:') || url.startsWith('data:')) return false
  if (typeof window === 'undefined') return true
  try {
    const resolved = new URL(url, window.location.href)
    return resolved.origin !== window.location.origin
  } catch {
    return false
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // Same-origin /backgrounds/* must NOT set crossOrigin — Vite static files
    // often omit ACAO and would taint the canvas, blocking getImageData.
    if (needsCors(url)) {
      img.crossOrigin = 'anonymous'
    }
    const timer = window.setTimeout(() => {
      img.src = ''
      reject(new Error('image load timeout'))
    }, 8_000)
    img.onload = () => {
      window.clearTimeout(timer)
      resolve(img)
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      reject(new Error('image load failed'))
    }
    img.src = url
  })
}

type Bin = { r: number; g: number; b: number; weight: number }

/**
 * Sample a downscaled wallpaper and pick a vibrant dominant hue.
 * Returns null when decode/canvas fails or the photo is effectively mono.
 */
export async function extractDominantAccent(imageUrl: string): Promise<string | null> {
  if (typeof document === 'undefined') return null
  let img: HTMLImageElement
  try {
    img = await loadImage(imageUrl)
  } catch {
    return null
  }

  const size = 48
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  try {
    ctx.drawImage(img, 0, 0, size, size)
  } catch {
    return null
  }

  let data: ImageData
  try {
    data = ctx.getImageData(0, 0, size, size)
  } catch {
    return null
  }

  const bins = new Map<number, Bin>()
  const { data: px } = data
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3]
    if (a < 200) continue
    const rgb = { r: px[i], g: px[i + 1], b: px[i + 2] }
    const hsl = rgbToHsl(rgb)
    if (hsl.s < 0.14) continue
    if (hsl.l < 0.10 || hsl.l > 0.90) continue
    const weight = hsl.s * (1 - Math.abs(hsl.l - 0.48) * 1.4)
    if (weight <= 0) continue
    const key = Math.floor(hsl.h * 24)
    const prev = bins.get(key)
    if (prev) {
      prev.r += rgb.r * weight
      prev.g += rgb.g * weight
      prev.b += rgb.b * weight
      prev.weight += weight
    } else {
      bins.set(key, { r: rgb.r * weight, g: rgb.g * weight, b: rgb.b * weight, weight })
    }
  }

  if (bins.size === 0) return null

  let best: Bin | null = null
  for (const bin of bins.values()) {
    if (!best || bin.weight > best.weight) best = bin
  }
  if (!best || best.weight < 0.5) return null

  return toHex({
    r: best.r / best.weight,
    g: best.g / best.weight,
    b: best.b / best.weight,
  })
}

/** Extract + tune for UI, or null when analysis cannot produce a usable accent. */
export async function extractWallpaperAccent(
  imageUrl: string,
  theme: AccentTheme = 'dark',
): Promise<string | null> {
  const raw = await extractDominantAccent(imageUrl)
  if (!raw) return null
  return tuneAccentForUi(raw, theme)
}
