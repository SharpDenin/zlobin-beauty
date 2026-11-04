import { describe, expect, it } from 'vitest'
import {
  CANONICAL_WORK_TYPE_OPTIONS,
  hasLegacyEmployeeFormat,
  normalizeWorkType,
  primaryWorkType,
  uniqueCanonicalWorkTypes,
  workTypeLabel,
  workTypeNeedsSalon,
} from './work-types'

describe('work formats', () => {
  it('exposes exactly four canonical options', () => {
    expect(CANONICAL_WORK_TYPE_OPTIONS.map((o) => o.value)).toEqual([
      'private_practice',
      'percentage_based',
      'mobile_service',
      'chair_rental',
    ])
    const labels = CANONICAL_WORK_TYPE_OPTIONS.map((o) => o.label)
    expect(new Set(labels).size).toBe(labels.length)
    for (const o of CANONICAL_WORK_TYPE_OPTIONS) {
      expect(o.description.length).toBeGreaterThan(20)
    }
  })

  it('normalizes aliases and strips ownership', () => {
    expect(normalizeWorkType('chair_master')).toBe('chair_rental')
    expect(normalizeWorkType('private_master')).toBe('private_practice')
    expect(normalizeWorkType('independent')).toBe('private_practice')
    expect(normalizeWorkType('mobile_master')).toBe('mobile_service')
    expect(normalizeWorkType('renter')).toBe('chair_rental')
    expect(normalizeWorkType('owner')).toBe('')
    expect(normalizeWorkType('salon_owner')).toBe('')
    expect(normalizeWorkType('chain_owner')).toBe('')
    expect(normalizeWorkType('employee')).toBe('employee')
  })

  it('dedupes multi-select and picks primary as first element', () => {
    expect(uniqueCanonicalWorkTypes(['independent', 'private_master', 'mobile_master'])).toEqual([
      'private_practice',
      'mobile_service',
    ])
    expect(primaryWorkType(['mobile_service', 'private_practice'])).toBe('mobile_service')
    expect(primaryWorkType(['independent', 'salon_owner', 'employee'])).toBe('private_practice')
  })

  it('never requires salon from format alone', () => {
    expect(workTypeNeedsSalon(['private_practice', 'mobile_service'])).toBe(false)
    expect(workTypeNeedsSalon(['employee'])).toBe(false)
    expect(workTypeNeedsSalon(['chair_rental', 'percentage_based'])).toBe(false)
  })

  it('labels aliases consistently and keeps employee distinct', () => {
    expect(workTypeLabel('chair_master')).toBe(workTypeLabel('chair_rental'))
    expect(workTypeLabel('private_master')).toBe('Частный мастер')
    expect(hasLegacyEmployeeFormat(['employee', 'private_practice'])).toBe(true)
    expect(hasLegacyEmployeeFormat(['private_practice'])).toBe(false)
  })
})
