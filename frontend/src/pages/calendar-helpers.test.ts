import { describe, expect, it } from 'vitest'
import { canDragAppointment, isTerminalStatus, minutesToTime } from './calendar-helpers'

describe('calendar helpers', () => {
  it('marks terminal appointments and blocks drag', () => {
    expect(isTerminalStatus('completed')).toBe(true)
    expect(isTerminalStatus('cancelled_by_salon')).toBe(true)
    expect(isTerminalStatus('no_show')).toBe(true)
    expect(isTerminalStatus('confirmed')).toBe(false)
    expect(canDragAppointment('confirmed')).toBe(true)
    expect(canDragAppointment('completed')).toBe(false)
    expect(canDragAppointment('confirmed', 'fixed_window')).toBe(false)
  })

  it('formats working-hour minutes for FullCalendar', () => {
    expect(minutesToTime(9 * 60)).toBe('09:00:00')
    expect(minutesToTime(22 * 60 + 30)).toBe('22:30:00')
  })
})
