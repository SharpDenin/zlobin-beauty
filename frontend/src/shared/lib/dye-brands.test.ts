import { describe, expect, it } from 'vitest'
import {
  brandMatchesSelection,
  canonicalizeBrand,
  DYE_BRAND_CANONICAL,
  mergeDyeBrandOptions,
  normalizeBrandKey,
} from './dye-brands'

describe('dye-brands', () => {
  it('normalizes spelling variants of L\'Oreal onto one key', () => {
    const a = normalizeBrandKey("L'Oreal")
    const b = normalizeBrandKey('L’Oréal')
    const c = normalizeBrandKey('loreal')
    expect(a).toBe(b)
    expect(a).toBe(c)
    expect(canonicalizeBrand('L’Oréal')).toBe("L'Oreal")
    expect(canonicalizeBrand('Loreal')).toBe("L'Oreal")
  })

  it('merges curated list with catalog brands without duplicates', () => {
    const merged = mergeDyeBrandOptions(["L'Oreal", 'loreal', 'Wella', 'Custom Dye Co'])
    const lorealHits = merged.filter((b) => normalizeBrandKey(b) === normalizeBrandKey("L'Oreal"))
    expect(lorealHits).toHaveLength(1)
    expect(merged).toContain('Wella')
    expect(merged).toContain('Custom Dye Co')
    expect(merged).toContain('Schwarzkopf Professional')
    expect(merged).toContain('EPICA Professional')
  })

  it('keeps curated brands when catalog is empty', () => {
    const merged = mergeDyeBrandOptions([])
    expect(merged.length).toBe(DYE_BRAND_CANONICAL.length)
    expect(merged).toEqual([...DYE_BRAND_CANONICAL].sort((a, b) => a.localeCompare(b, 'ru', { sensitivity: 'base' })))
  })

  it('adds a custom brand via extra without duplicating curated', () => {
    const merged = mergeDyeBrandOptions([], '  Matrix  ')
    expect(merged.filter((b) => normalizeBrandKey(b) === normalizeBrandKey('Matrix'))).toHaveLength(1)
    expect(mergeDyeBrandOptions([], 'Brand X')).toContain('Brand X')
  })

  it('matches product brands to picker selection after canonicalization', () => {
    expect(brandMatchesSelection("L'Oreal", 'L’Oréal')).toBe(true)
    expect(brandMatchesSelection('Wella', 'Wella')).toBe(true)
    expect(brandMatchesSelection('Wella', 'Estel')).toBe(false)
  })
})
