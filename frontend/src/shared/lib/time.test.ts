import { describe, expect, it } from 'vitest'
import { datetimeLocalToIso, wallTimeInTimezoneToUtcIso } from './time'

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
})
