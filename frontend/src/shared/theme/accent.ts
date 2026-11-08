/** Derived accent tokens from one base color. Same token names as the design system. */

export type Rgb = { r: number; g: number; b: number }
export type AccentTheme = 'light' | 'dark'

export type AccentTokens = {
  primary: string
  hover: string
  soft: string
  muted: string
  ink: string
  focus: string
  glow: string
  shadowGlow: string
  button: string
  canvas: string
  hero: string
}

export const DEFAULT_UI_ACCENT = '#7C82FF'

type Hsl = { h: number; s: number; l: number }

export function parseHex(input: string): Rgb {
  const hex = input.trim().replace('#', '')
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return { r: 124, g: 130, b: 255 }
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  }
}

export function toHex({ r, g, b }: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return `#${[clamp(r), clamp(g), clamp(b)].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  }
}

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

function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const v = l * 255
    return { r: v, g: v, b: v }
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return {
    r: hue2rgb(p, q, h + 1 / 3) * 255,
    g: hue2rgb(p, q, h) * 255,
    b: hue2rgb(p, q, h - 1 / 3) * 255,
  }
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

/** Relative luminance, 0–1, sRGB. */
export function luminance(rgb: Rgb): number {
  const f = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b)
}

function rgba(rgb: Rgb, alpha: number): string {
  return `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${alpha})`
}

/** Ink that stays readable on the accent fill (buttons, selected chips). */
export function contrastInk(rgb: Rgb): string {
  return luminance(rgb) > 0.42 ? '#0B0D12' : '#F5F7FA'
}

/**
 * Shape a raw photo color into a UI accent for the active theme.
 * Does not re-analyze the image — safe to call on every theme toggle.
 */
export function tuneAccentForUi(baseHex: string, theme: AccentTheme = 'dark'): string {
  const hsl = rgbToHsl(parseHex(baseHex))
  if (hsl.s < 0.08) return DEFAULT_UI_ACCENT

  hsl.s = clamp01(Math.max(hsl.s, theme === 'light' ? 0.42 : 0.36))
  hsl.s = clamp01(Math.min(hsl.s, 0.88))

  if (theme === 'light') {
    hsl.l = clamp01(Math.min(Math.max(hsl.l, 0.30), 0.52))
  } else {
    hsl.l = clamp01(Math.min(Math.max(hsl.l, 0.40), 0.68))
  }

  const rgb = hslToRgb(hsl)
  const lum = luminance(rgb)
  if (theme === 'light' && lum > 0.62) {
    return toHex(hslToRgb({ ...hsl, l: clamp01(hsl.l - 0.12) }))
  }
  if (theme === 'dark' && lum < 0.18) {
    return toHex(hslToRgb({ ...hsl, l: clamp01(hsl.l + 0.18) }))
  }
  return toHex(rgb)
}

export function deriveAccent(baseHex: string): AccentTokens {
  const base = parseHex(baseHex)
  const white = { r: 255, g: 255, b: 255 }
  const black = { r: 11, g: 13, b: 18 }
  const soft = mix(base, white, 0.28)
  const hover = luminance(base) > 0.45 ? mix(base, black, 0.12) : mix(base, white, 0.16)
  const primary = toHex(base)
  const ink = contrastInk(base)
  return {
    primary,
    hover: toHex(hover),
    soft: toHex(soft),
    muted: rgba(base, 0.16),
    ink,
    focus: rgba(base, 0.32),
    glow: rgba(base, 0.22),
    shadowGlow: `0 0 0 1px ${rgba(base, 0.22)}, 0 12px 32px ${rgba(base, 0.16)}`,
    button: `linear-gradient(180deg, ${toHex(soft)} 0%, ${primary} 100%)`,
    canvas: `radial-gradient(1200px 640px at 12% -10%, ${rgba(base, 0.16)}, transparent 58%), radial-gradient(900px 520px at 92% 8%, ${rgba(soft, 0.10)}, transparent 52%), var(--color-background)`,
    hero: `radial-gradient(80% 120% at 100% 0%, ${rgba(base, 0.20)}, transparent 62%), linear-gradient(180deg, var(--color-surface-2) 0%, var(--color-surface) 100%)`,
  }
}

export function readDocumentTheme(): AccentTheme {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

/**
 * Apply wallpaper-derived (or curated) accent onto shared CSS variables.
 * Theme tweaks run before derivation so theme toggles do not re-scan the photo.
 */
export function applyAccent(baseHex: string, theme: AccentTheme = readDocumentTheme()) {
  if (typeof document === 'undefined') return
  const tuned = tuneAccentForUi(baseHex, theme)
  const tokens = deriveAccent(tuned)
  const root = document.documentElement
  const set = (name: string, value: string) => root.style.setProperty(name, value)
  set('--color-primary', tokens.primary)
  set('--color-primary-hover', tokens.hover)
  set('--color-primary-soft', tokens.soft)
  set('--color-primary-muted', tokens.muted)
  set('--color-primary-ink', tokens.ink)
  set('--color-accent', tokens.primary)
  set('--color-accent-hover', tokens.hover)
  set('--color-accent-soft', tokens.muted)
  set('--color-focus-ring', tokens.focus)
  set('--color-glow', tokens.glow)
  set('--shadow-glow', tokens.shadowGlow)
  set('--gradient-primary-button', tokens.button)
  set('--gradient-canvas', tokens.canvas)
  set('--gradient-hero', tokens.hero)
  set('--gradient-image-fallback', `linear-gradient(145deg, ${tokens.muted} 0%, var(--color-surface-2) 48%, var(--color-surface) 100%)`)
  root.dataset.accent = tokens.primary
}
