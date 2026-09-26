import { describe, expect, it } from 'vitest'
import {
  canRescheduleAppointment,
  groupSlotsByDate,
  isRaceSlotError,
  slotDateLabel,
  slotTimeLabel,
} from './reschedule-helpers'

describe('reschedule helpers', () => {
  it('allows only live flexible appointments', () => {
    expect(canRescheduleAppointment('confirmed', 'flexible')).toBe(true)
    expect(canRescheduleAppointment('pending_confirmation')).toBe(true)
    expect(canRescheduleAppointment('confirmed', 'fixed_window')).toBe(false)
    expect(canRescheduleAppointment('completed', 'flexible')).toBe(false)
    expect(canRescheduleAppointment('cancelled_by_client')).toBe(false)
  })

  it('groups slots by salon calendar date with Сегодня/Завтра labels', () => {
    const tz = 'Europe/Moscow'
    const now = new Date('2026-09-01T08:00:00+03:00')
    const groups = groupSlotsByDate(
      [
        { starts_at: '2026-09-01T13:00:00.000Z', ends_at: '2026-09-01T14:00:00.000Z' },
        { starts_at: '2026-09-01T14:30:00.000Z', ends_at: '2026-09-01T15:30:00.000Z' },
        { starts_at: '2026-09-02T08:00:00.000Z', ends_at: '2026-09-02T09:00:00.000Z' },
        { starts_at: '2026-09-03T07:00:00.000Z', ends_at: '2026-09-03T08:00:00.000Z' },
      ],
      tz,
      now,
    )
    expect(groups).toHaveLength(3)
    expect(groups[0].label).toBe('Сегодня')
    expect(groups[0].slots).toHaveLength(2)
    expect(groups[1].label).toBe('Завтра')
    expect(groups[2].label).toMatch(/сентябр/i)
    expect(slotTimeLabel('2026-09-01T13:00:00.000Z', tz)).toMatch(/16:00/)
    expect(slotDateLabel('2026-09-03T07:00:00.000Z', tz, now)).toMatch(/3/)
  })

  it('keeps Сегодня/Завтра on the salon calendar around midnight', () => {
    const tz = 'Europe/Moscow'
    const late = new Date('2026-09-01T21:30:00+03:00')
    expect(slotDateLabel('2026-09-01T20:00:00.000Z', tz, late)).toBe('Сегодня')
    expect(slotDateLabel('2026-09-02T08:00:00.000Z', tz, late)).toBe('Завтра')
    const afterMidnight = new Date('2026-09-02T00:30:00+03:00')
    expect(slotDateLabel('2026-09-01T21:30:00.000Z', tz, afterMidnight)).toBe('Сегодня')
    expect(slotDateLabel('2026-09-02T21:00:00.000Z', tz, afterMidnight)).toBe('Завтра')
  })

  it('treats conflict codes as a taken-slot race', () => {
    expect(isRaceSlotError('appointment_time_conflict')).toBe(true)
    expect(isRaceSlotError('appointment_concurrent_update')).toBe(true)
    expect(isRaceSlotError('appointment_status_invalid')).toBe(false)
  })
})
