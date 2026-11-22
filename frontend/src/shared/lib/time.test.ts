import { describe, expect, it } from 'vitest'
import {
  addDaysYmd,
  datetimeLocalToIso,
  dateWallToIso,
  formatLocalInTimezone,
  instantOnYmd,
  wallTimeInTimezoneToUtcIso,
  ymdFromLocalDate,
  ymdInTimezone,
  zonedDayBoundsUtc,
} from './time'

describe('datetimeLocalToIso interprets salon timezone', () => {
  it('converts Krasnoyarsk wall time without browser TZ', () => {
    // 2026-08-20 14:00 in Asia/Krasnoyarsk (UTC+7) => 07:00Z
    const iso = datetimeLocalToIso('2026-08-20T14:00', 'Asia/Krasnoyarsk')
    expect(iso).toBe('2026-08-20T07:00:00.000Z')
  })

  it('converts Moscow wall time', () => {
    const iso = wallTimeInTimezoneToUtcIso(2026, 1, 15, 12, 0, 0, 'Europe/Moscow')
    expect(iso).toBe('2026-01-15T09:00:00.000Z')
  })

  it('dateWallToIso uses the Date wall clock in the salon zone', () => {
    const wall = new Date(2026, 7, 20, 14, 0, 0)
    expect(dateWallToIso(wall, 'Asia/Krasnoyarsk')).toBe('2026-08-20T07:00:00.000Z')
    expect(dateWallToIso(wall, 'UTC')).toBe('2026-08-20T14:00:00.000Z')
  })

  it('round-trips appointment wall time for create and reschedule', () => {
    const created = datetimeLocalToIso('2026-11-12T16:00', 'Europe/Moscow')
    const rescheduled = datetimeLocalToIso('2026-11-12T16:00', 'Europe/Moscow')
    expect(created).toBe(rescheduled)
    expect(formatLocalInTimezone(created, 'Europe/Moscow')).toMatch(/16:00/)
  })
})

describe('ymdInTimezone / day bounds', () => {
  it('keeps salon calendar day across UTC midnight', () => {
    // 2026-08-20 02:00 Krasnoyarsk = 2026-08-19 19:00Z
    const iso = '2026-08-19T19:00:00.000Z'
    expect(ymdInTimezone(iso, 'Asia/Krasnoyarsk')).toBe('2026-08-20')
    expect(ymdInTimezone(iso, 'UTC')).toBe('2026-08-19')
    expect(instantOnYmd(iso, '2026-08-20', 'Asia/Krasnoyarsk')).toBe(true)
    expect(instantOnYmd(iso, '2026-08-19', 'Asia/Krasnoyarsk')).toBe(false)
  })

  it('handles month and year boundaries', () => {
    expect(ymdInTimezone('2026-12-31T21:00:00.000Z', 'Europe/Moscow')).toBe('2027-01-01')
    expect(addDaysYmd('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysYmd('2026-01-31', 1)).toBe('2026-02-01')
  })

  it('zoned day bounds do not shift duration of a same-day appointment', () => {
    const { startIso, endIso } = zonedDayBoundsUtc('2026-08-20', 'Asia/Krasnoyarsk')
    expect(startIso).toBe('2026-08-19T17:00:00.000Z')
    expect(endIso).toBe('2026-08-20T17:00:00.000Z')
    const appt = datetimeLocalToIso('2026-08-20T10:00', 'Asia/Krasnoyarsk')
    expect(appt >= startIso && appt < endIso).toBe(true)
  })

  it('ymdFromLocalDate ignores UTC shift from toISOString', () => {
    const local = new Date(2026, 0, 1, 0, 30, 0) // Jan 1 00:30 local
    expect(ymdFromLocalDate(local)).toBe('2026-01-01')
  })

  it('formats message-like absolute timestamps in device-independent salon zone', () => {
    const sent = '2026-08-20T07:05:00.000Z'
    expect(formatLocalInTimezone(sent, 'Asia/Krasnoyarsk', { hour: '2-digit', minute: '2-digit' })).toMatch(/14:05/)
    expect(formatLocalInTimezone(sent, 'Europe/Moscow', { hour: '2-digit', minute: '2-digit' })).toMatch(/10:05/)
  })
})
