import { describe, expect, it } from 'vitest'
import { contrastInk, deriveAccent, luminance, parseHex } from '@/shared/theme/accent'
import { HOME_BACKGROUNDS, backgroundById } from '@/shared/theme/backgrounds'

describe('deriveAccent', () => {
  it('keeps dark ink on the bright forest mint', () => {
    const tokens = deriveAccent('#7EE0C6')
    expect(tokens.ink).toBe('#0B0D12')
    expect(tokens.primary).toBe('#7ee0c6')
    expect(tokens.button).toContain('#7ee0c6')
    expect(luminance(parseHex(tokens.primary))).toBeGreaterThan(0.42)
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
