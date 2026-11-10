import { describe, expect, it } from 'vitest'
import { tokens } from './tokens'

describe('glass hierarchy tokens', () => {
  it('exposes a fullscreen lens as the primary blur layer', () => {
    expect(tokens.glass.lensBlur).toMatch(/px$/)
    expect(Number.parseInt(tokens.glass.lensBlur, 10)).toBeGreaterThan(0)
    expect(tokens.glass.lensFill).toContain('transparent')
    expect(tokens.glass.lensFillFallback).toContain('transparent')
  })

  it('keeps panel/chrome blur at zero to avoid stacked filters', () => {
    expect(tokens.glass.blur).toBe('0px')
    expect(tokens.glass.blurSubtle).toBe('0px')
    expect(Number.parseInt(tokens.glass.blurStrong, 10)).toBeGreaterThan(0)
  })

  it('provides denser fills for work surfaces and controls', () => {
    expect(tokens.glass.workFill).toBeTruthy()
    expect(tokens.glass.controlFill).toBeTruthy()
    expect(tokens.glass.chromeFill).toBeTruthy()
    expect(tokens.glass.fillStrong).toBeTruthy()
  })

  it('keeps secondary text brighter than the legacy #9EA6B5 wash on photo', () => {
    expect(tokens.color.textSecondary.toLowerCase()).toBe('#b8bfc9')
    expect(tokens.color.textTertiary.toLowerCase()).toBe('#8b93a3')
  })

  it('uses a vertical readability scrim on the wallpaper overlay', () => {
    expect(tokens.appBackground.overlay).toContain('180deg')
    expect(tokens.appBackground.overlay).toContain('0B0D12')
  })
})
