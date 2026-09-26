import { describe, expect, it } from 'vitest'
import { initials } from './initials'
import { appointmentTone } from '@/shared/ui/AppointmentCard'

describe('initials', () => {
  it('uses first letters of two words', () => {
    expect(initials('Анна Иванова')).toBe('АИ')
  })
  it('falls back for empty name', () => {
    expect(initials('')).toBe('—')
  })
})

describe('appointmentTone', () => {
  it('maps statuses beyond colour-only badges', () => {
    expect(appointmentTone('pending_confirmation')).toBe('waiting')
    expect(appointmentTone('confirmed')).toBe('upcoming')
    expect(appointmentTone('in_progress')).toBe('live')
    expect(appointmentTone('completed')).toBe('done')
    expect(appointmentTone('cancelled_by_client')).toBe('cancelled')
  })
})
