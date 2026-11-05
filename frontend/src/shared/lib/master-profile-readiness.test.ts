import { describe, expect, it } from 'vitest'
import { incompleteChecks, readinessAnchor, readinessFieldHint } from './master-profile-readiness'

const checks = [
  { key: 'display_name', label: 'Имя', ok: true },
  { key: 'city', label: 'Город', ok: false, missing: 'Город' },
  { key: 'specializations', label: 'Специализация', ok: false },
  { key: 'service', label: 'Услуга', ok: false },
]

describe('master profile readiness helpers', () => {
  it('lists only incomplete checks', () => {
    expect(incompleteChecks(checks).map((c) => c.key)).toEqual(['city', 'specializations', 'service'])
  })

  it('maps field hints next to form controls', () => {
    expect(readinessFieldHint(checks, 'city')).toMatch(/город/i)
    expect(readinessFieldHint(checks, 'display_name')).toBeNull()
    expect(readinessFieldHint(checks, 'specializations')).toMatch(/специализац/i)
  })

  it('provides anchors for in-page navigation', () => {
    expect(readinessAnchor('city')).toBe('master-city')
    expect(readinessAnchor('profession_types')).toBe('master-profession-types')
    expect(readinessAnchor('unknown')).toBeNull()
  })
})
