import { describe, expect, it } from 'vitest'
import {
  CANONICAL_WORK_TYPE_OPTIONS,
  normalizeWorkType,
  primaryWorkType,
  uniqueCanonicalWorkTypes,
  workTypeLabel,
  workTypeNeedsSalon,
} from './work-types'

describe('work formats', () => {
  it('exposes unique canonical labels', () => {
    const labels = CANONICAL_WORK_TYPE_OPTIONS.map((o) => o.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('normalizes aliases', () => {
    expect(normalizeWorkType('chair_master')).toBe('renter')
    expect(normalizeWorkType('private_master')).toBe('independent')
    expect(normalizeWorkType('owner')).toBe('salon_owner')
  })

  it('dedupes multi-select and picks primary', () => {
    expect(uniqueCanonicalWorkTypes(['independent', 'private_master', 'mobile_master'])).toEqual([
      'independent',
      'mobile_master',
    ])
    expect(primaryWorkType(['independent', 'salon_owner', 'employee'])).toBe('salon_owner')
  })

  it('detects salon requirement', () => {
    expect(workTypeNeedsSalon(['independent', 'mobile_master'])).toBe(false)
    expect(workTypeNeedsSalon(['employee'])).toBe(true)
    expect(workTypeNeedsSalon(['renter', 'independent'])).toBe(true)
  })

  it('labels aliases consistently', () => {
    expect(workTypeLabel('chair_master')).toBe(workTypeLabel('renter'))
    expect(workTypeLabel('private_master')).toBe('Частный мастер')
  })
})
