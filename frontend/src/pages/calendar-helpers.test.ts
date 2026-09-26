import { describe, expect, it } from 'vitest'
import {
  appointmentToneClass,
  buildDayStrip,
  canDragAppointment,
  eventOverlapsDay,
  isTerminalStatus,
  minutesToTime,
  visitCompanionTitle,
  weekdayIndex,
  zonedYmd,
} from './calendar-helpers'

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

  it('maps appointment visual tone and visit companions', () => {
    expect(appointmentToneClass('cancelled_by_client')).toContain('is-terminal')
    expect(appointmentToneClass('confirmed')).toContain('is-busy')
    expect(appointmentToneClass('pending_confirmation')).toContain('is-pending')
    expect(visitCompanionTitle('Стрижка', ['Стрижка', 'Окрашивание'])).toBe('Окрашивание')
  })

  it('builds a day strip around the anchor in a named timezone', () => {
    const strip = buildDayStrip(new Date('2026-08-30T12:00:00+07:00'), 'Asia/Krasnoyarsk', 7)
    expect(strip).toHaveLength(7)
    expect(strip.some((d) => d.ymd === '2026-08-30')).toBe(true)
    expect(zonedYmd(new Date('2026-08-30T01:00:00Z'), 'Europe/Moscow')).toBe('2026-08-30')
    expect(eventOverlapsDay('2026-08-30T10:00:00+07:00', '2026-08-30T11:00:00+07:00', '2026-08-30', 'Asia/Krasnoyarsk')).toBe(true)
    expect(weekdayIndex(new Date('2026-08-30T12:00:00+07:00'), 'Asia/Krasnoyarsk')).toBe(0)
  })
})
