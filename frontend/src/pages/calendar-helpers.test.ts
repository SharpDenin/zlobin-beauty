import { describe, expect, it } from 'vitest'
import {
  appointmentToneClass,
  buildDayStrip,
  calendarColorClass,
  calendarColorCss,
  CALENDAR_COLOR_LABELS,
  canDragAppointment,
  countEventsOutsideRange,
  detectHorizontalSwipe,
  swipeStep,
  eventOverlapsDay,
  extendDisplayRangeForEvents,
  isCalendarViewId,
  isTerminalStatus,
  longPressMoved,
  LONG_PRESS_SLOP_PX,
  minutesToTime,
  normalizeCalendarColor,
  rangeToDayInterval,
  snapMinutes,
  validateDisplayRange,
  visitCompanionTitle,
  weekdayIndex,
  zonedYmd,
} from './calendar-helpers'

describe('long press', () => {
  it('cancels only after the finger moves more than 16px', () => {
    expect(longPressMoved(0, LONG_PRESS_SLOP_PX)).toBe(false)
    expect(longPressMoved(0, LONG_PRESS_SLOP_PX + 1)).toBe(true)
    expect(longPressMoved(12, 12)).toBe(true)
  })
})

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

  it('validates display range with 4h min and 30-min snap', () => {
    expect(validateDisplayRange('08:00', '22:00')).toEqual({ ok: true, value: { from: '08:00', to: '22:00' } })
    expect(validateDisplayRange('08:10', '12:20').ok).toBe(true)
    expect(validateDisplayRange('08:10', '12:20')).toMatchObject({ value: { from: '08:00', to: '12:30' } })
    expect(validateDisplayRange('10:00', '12:00').ok).toBe(false)
    expect(validateDisplayRange('14:00', '10:00').ok).toBe(false)
    expect(snapMinutes(68, 15)).toBe(75)
    expect(snapMinutes(67, 30)).toBe(60)
  })

  it('extends display range so outside events stay reachable', () => {
    const extended = extendDisplayRangeForEvents({ from: '10:00', to: '18:00' }, [7 * 60, 21 * 60])
    expect(extended.from <= '07:00' || extended.from === '06:30' || extended.from === '07:00').toBe(true)
    expect(parseInt(extended.to.slice(0, 2), 10)).toBeGreaterThanOrEqual(21)
    expect(countEventsOutsideRange([7 * 60, 12 * 60, 23 * 60], 8 * 60, 22 * 60)).toEqual({ earlier: 1, later: 1 })
  })

  it('maps palette tokens and keeps legacy hex', () => {
    expect(normalizeCalendarColor('success', 'task')).toBe('success')
    expect(normalizeCalendarColor('', 'break')).toBe('info')
    expect(normalizeCalendarColor('var(--color-danger)', 'task')).toBe('danger')
    expect(normalizeCalendarColor('#7C82FF', 'task')).toBe('#7c82ff')
    expect(calendarColorCss('primary')).toBe('var(--color-primary)')
    expect(calendarColorCss('#abcdef')).toBe('#abcdef')
    expect(calendarColorClass('warning')).toBe('cal-color-warning')
    expect(calendarColorClass('#112233')).toBe('cal-color-hex')
  })

  it('exposes Russian labels for calendar color tokens', () => {
    expect(CALENDAR_COLOR_LABELS.primary).toBe('Фиолетовый')
    expect(CALENDAR_COLOR_LABELS.success).toBe('Зелёный')
  })

  it('swipes a month/week by period and a compact day by one day', () => {
    expect(swipeStep('timeGridDay', true)).toBe('day')
    expect(swipeStep('dayGridMonth', true)).toBe('period')
    expect(swipeStep('timeGridWeek', false)).toBe('period')
    expect(swipeStep('timeGridThreeDay', true)).toBe('period')
  })

  it('detects horizontal swipe without fighting vertical scroll', () => {
    expect(detectHorizontalSwipe(-80, 10)).toBe('left')
    expect(detectHorizontalSwipe(80, 5)).toBe('right')
    expect(detectHorizontalSwipe(-80, 70)).toBe(null)
    expect(detectHorizontalSwipe(-40, 0)).toBe(null)
  })

  it('accepts only buttons/swipe navigation modes', async () => {
    const { isCalendarNavMode } = await import('./calendar-helpers')
    expect(isCalendarNavMode('buttons')).toBe(true)
    expect(isCalendarNavMode('swipe')).toBe(true)
    expect(isCalendarNavMode('gesture')).toBe(false)
  })

  it('maps a same-day range to schedule-exception minutes', () => {
    const tz = 'Asia/Krasnoyarsk'
    const start = new Date('2026-08-30T02:00:00Z') // 09:00 in +07
    const end = new Date('2026-08-30T05:00:00Z') // 12:00 in +07
    expect(rangeToDayInterval(start, end, tz)).toEqual({
      day: '2026-08-30',
      start_minute: 9 * 60,
      end_minute: 12 * 60,
    })
    const midnight = new Date('2026-08-30T17:00:00Z') // 00:00 next day in +07
    expect(rangeToDayInterval(start, midnight, tz)?.end_minute).toBe(1440)
    expect(isCalendarViewId('timeGridThreeDay')).toBe(true)
    expect(isCalendarViewId('timeGridYear')).toBe(false)
  })
})
