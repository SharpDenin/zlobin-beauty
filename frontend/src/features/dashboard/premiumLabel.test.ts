import { describe, expect, it } from 'vitest'
import { premiumHeaderState, premiumLabel } from './premiumLabel'

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

describe('premiumHeaderState', () => {
  it('marks inactive free plan with CTA detail', () => {
    expect(premiumHeaderState(undefined)).toEqual({ active: false, label: 'Premium', detail: 'Подключить' })
    expect(premiumHeaderState({ effective_plan: 'free', status: 'none' })).toEqual({
      active: false,
      label: 'Premium',
      detail: 'Подключить',
    })
  })

  it('marks active premium without CTA', () => {
    expect(premiumHeaderState({ effective_plan: 'premium', status: 'active' })).toEqual({
      active: true,
      label: 'Premium',
    })
  })
})
