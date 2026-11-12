import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deviceTimeZone,
  resolveServiceTimezone,
  timezoneForCity,
} from './service-timezone'
import { formatDeviceLocal, formatLocalInTimezone, wallTimeInTimezoneToUtcIso } from './time'

describe('service timezone resolution', () => {
  it('maps known service cities to IANA zones', () => {
    expect(timezoneForCity('Красноярск')).toBe('Asia/Krasnoyarsk')
    expect(timezoneForCity('Москва')).toBe('Europe/Moscow')
    expect(timezoneForCity('Новосибирск')).toBe('Asia/Novosibirsk')
    expect(timezoneForCity('Unknown')).toBeNull()
  })

  it('prefers explicit IANA over city', () => {
    expect(resolveServiceTimezone('Europe/Moscow', 'Красноярск')).toBe('Europe/Moscow')
    expect(resolveServiceTimezone('', 'Красноярск')).toBe('Asia/Krasnoyarsk')
  })

  it('flags unknown cities as fallback risk for writes', async () => {
    const { wouldUseTimezoneFallback } = await import('./service-timezone')
    expect(wouldUseTimezoneFallback('', 'Владивосток')).toBe(true)
    expect(wouldUseTimezoneFallback('Asia/Vladivostok', 'Владивосток')).toBe(false)
    expect(wouldUseTimezoneFallback('', 'Красноярск')).toBe(false)
  })
})

describe('device-local now (calendar «Сейчас»)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('formats current instant in Krasnoyarsk device zone', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'Asia/Krasnoyarsk',
    } as Intl.ResolvedDateTimeFormatOptions)
    expect(deviceTimeZone()).toBe('Asia/Krasnoyarsk')
    // Fixed UTC instant = 17:30 in Krasnoyarsk (UTC+7)
    const label = formatDeviceLocal('2026-06-15T10:30:00.000Z')
    expect(label).toMatch(/17:30/)
  })

  it('formats current instant in Moscow device zone', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'Europe/Moscow',
    } as Intl.ResolvedDateTimeFormatOptions)
    expect(deviceTimeZone()).toBe('Europe/Moscow')
    // Same UTC instant = 13:30 in Moscow (UTC+3)
    const label = formatDeviceLocal('2026-06-15T10:30:00.000Z')
    expect(label).toMatch(/13:30/)
  })

  it('does not show Moscow wall clock when device is Krasnoyarsk', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'Asia/Krasnoyarsk',
    } as Intl.ResolvedDateTimeFormatOptions)
    const device = formatDeviceLocal('2026-06-15T10:30:00.000Z')
    const moscow = formatLocalInTimezone('2026-06-15T10:30:00.000Z', 'Europe/Moscow')
    expect(device).toMatch(/17:30/)
    expect(moscow).toMatch(/13:30/)
    expect(device).not.toBe(moscow)
  })
})

describe('cross-city booking wall clocks', () => {
  it('Krasnoyarsk client booking Moscow master 16:00 → Moscow wall / UTC 13:00Z', () => {
    const iso = wallTimeInTimezoneToUtcIso(2026, 6, 15, 16, 0, 0, 'Europe/Moscow')
    expect(iso).toBe('2026-06-15T13:00:00.000Z')
    expect(formatLocalInTimezone(iso, 'Europe/Moscow')).toMatch(/16:00/)
    // Client device in Krasnoyarsk sees a different local clock for the same instant
    expect(formatLocalInTimezone(iso, 'Asia/Krasnoyarsk')).toMatch(/20:00/)
  })

  it('Moscow client booking Krasnoyarsk master 16:00 → Krasnoyarsk wall / UTC 09:00Z', () => {
    const iso = wallTimeInTimezoneToUtcIso(2026, 6, 15, 16, 0, 0, 'Asia/Krasnoyarsk')
    expect(iso).toBe('2026-06-15T09:00:00.000Z')
    expect(formatLocalInTimezone(iso, 'Asia/Krasnoyarsk')).toMatch(/16:00/)
    expect(formatLocalInTimezone(iso, 'Europe/Moscow')).toMatch(/12:00/)
  })

  it('master and client see the same service-location wall time (no unexpected shift)', () => {
    const iso = wallTimeInTimezoneToUtcIso(2026, 6, 15, 16, 0, 0, 'Europe/Moscow')
    const masterView = formatLocalInTimezone(iso, 'Europe/Moscow')
    const clientView = formatLocalInTimezone(iso, 'Europe/Moscow')
    expect(masterView).toBe(clientView)
    expect(masterView).toMatch(/16:00/)
  })

  it('create / reschedule / move keep the same UTC instant for the same wall time', () => {
    const created = wallTimeInTimezoneToUtcIso(2026, 6, 15, 16, 0, 0, 'Asia/Krasnoyarsk')
    const moved = wallTimeInTimezoneToUtcIso(2026, 6, 15, 16, 0, 0, 'Asia/Krasnoyarsk')
    expect(created).toBe(moved)
    const nextDay = wallTimeInTimezoneToUtcIso(2026, 6, 16, 16, 0, 0, 'Asia/Krasnoyarsk')
    expect(nextDay).toBe('2026-06-16T09:00:00.000Z')
  })

  it('handles month boundary when converting service-local evening to UTC', () => {
    // 2026-07-01 01:00 Krasnoyarsk = 2026-06-30 18:00Z
    const iso = wallTimeInTimezoneToUtcIso(2026, 7, 1, 1, 0, 0, 'Asia/Krasnoyarsk')
    expect(iso).toBe('2026-06-30T18:00:00.000Z')
    expect(formatLocalInTimezone(iso, 'Asia/Krasnoyarsk')).toMatch(/01:00/)
  })
})

describe('DST transitions (zones that observe DST)', () => {
  it('rejects non-existent Berlin spring-forward wall time', () => {
    // 2026-03-29 02:30 does not exist in Europe/Berlin
    expect(() => wallTimeInTimezoneToUtcIso(2026, 3, 29, 2, 30, 0, 'Europe/Berlin')).toThrow(
      /cannot interpret wall time/,
    )
  })

  it('resolves a valid post-transition Berlin wall time', () => {
    const iso = wallTimeInTimezoneToUtcIso(2026, 3, 29, 3, 30, 0, 'Europe/Berlin')
    expect(iso).toBe('2026-03-29T01:30:00.000Z')
    expect(formatLocalInTimezone(iso, 'Europe/Berlin')).toMatch(/03:30/)
  })
})
