import { describe, expect, it } from 'vitest'
import { statusLabel } from './status'

describe('appointment status labels', () => {
  it('maps pending confirmation', () => {
    expect(statusLabel('pending_confirmation')).toBe('Ожидает подтверждения')
  })

  it('maps confirmed', () => {
    expect(statusLabel('confirmed')).toBe('Подтверждена')
  })
})
