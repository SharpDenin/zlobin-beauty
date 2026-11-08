import { describe, expect, it } from 'vitest'
import {
  contrastInk,
  DEFAULT_UI_ACCENT,
  deriveAccent,
  luminance,
  parseHex,
  tuneAccentForUi,
} from '@/shared/theme/accent'
import { HOME_BACKGROUNDS, backgroundById } from '@/shared/theme/backgrounds'

describe('deriveAccent', () => {
  it('keeps dark ink on the bright forest mint', () => {
    const tuned = tuneAccentForUi('#7EE0C6', 'dark')
    const tokens = deriveAccent(tuned)
    expect(tokens.ink).toBe('#0B0D12')
    expect(tokens.button).toContain(tokens.primary)
    expect(luminance(parseHex(tokens.primary))).toBeGreaterThan(0.18)
  })

  it('uses light ink on a deep accent', () => {
    expect(contrastInk(parseHex('#2A2E6B'))).toBe('#F5F7FA')
  })

  it('derives a distinct accent for every local background', () => {
    const accents = HOME_BACKGROUNDS.map((b) => deriveAccent(b.accent).primary)
    expect(new Set(accents).size).toBe(HOME_BACKGROUNDS.length)
    expect(backgroundById('missing').id).toBe(HOME_BACKGROUNDS[0].id)
  })
})

describe('tuneAccentForUi', () => {
  it('falls back to the system violet for near-mono greys', () => {
    expect(tuneAccentForUi('#777777', 'dark')).toBe(DEFAULT_UI_ACCENT)
  })

  it('darkens a washed-out pastel for light theme readability', () => {
    const tuned = tuneAccentForUi('#C8F5E8', 'light')
    expect(luminance(parseHex(tuned))).toBeLessThan(0.62)
  })

  it('lifts a muddy dark sample for dark theme CTA visibility', () => {
    const tuned = tuneAccentForUi('#1A3A2A', 'dark')
    expect(luminance(parseHex(tuned))).toBeGreaterThan(0.18)
  })

  it('keeps hue family when shaping a saturated wallpaper color', () => {
    const tuned = tuneAccentForUi('#E0B15A', 'dark')
    const base = parseHex('#E0B15A')
    const out = parseHex(tuned)
    // Gold stays warmer than cyan/violet — red channel dominates green+blue avg shift.
    expect(out.r).toBeGreaterThan(out.b)
    expect(Math.abs(out.r - base.r)).toBeLessThan(80)
  })
})
