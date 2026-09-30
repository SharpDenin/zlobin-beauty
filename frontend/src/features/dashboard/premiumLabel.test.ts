import { describe, expect, it } from 'vitest'
import { premiumLabel } from './premiumLabel'

describe('premiumLabel', () => {
  it('formats trial / premium / free', () => {
    expect(premiumLabel(undefined)).toBe('Free')
    expect(premiumLabel({ effective_plan: 'premium', status: 'active' })).toBe('Premium')
    expect(premiumLabel({
      status: 'trial',
      trial_ends_at: '2026-12-01T00:00:00.000Z',
      effective_plan: 'premium',
    })).toMatch(/^Пробный период до /)
  })
})
