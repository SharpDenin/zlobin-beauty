/**
 * Service-location IANA zones (keep in sync with backend/shared/tz and geo_cities).
 * Never use fixed UTC offsets — always IANA IDs.
 */

const CITY_TIMEZONES: Record<string, string> = {
  красноярск: 'Asia/Krasnoyarsk',
  новосибирск: 'Asia/Novosibirsk',
  москва: 'Europe/Moscow',
  'санкт-петербург': 'Europe/Moscow',
  петербург: 'Europe/Moscow',
  спб: 'Europe/Moscow',
}

/** Last-resort when city and explicit zone are unknown. Prefer resolveServiceTimezone. */
export const SERVICE_TIMEZONE_FALLBACK = 'Europe/Moscow'

export function timezoneForCity(city: string | null | undefined): string | null {
  const key = (city ?? '').trim().toLowerCase()
  if (!key) return null
  return CITY_TIMEZONES[key] ?? null
}

/**
 * Resolve the IANA timezone of a place where a service is provided.
 * explicit → city map → fallback (display/BC only — do not use for new branch writes).
 */
export function resolveServiceTimezone(
  explicit?: string | null,
  city?: string | null,
): string {
  const tz = (explicit ?? '').trim()
  if (tz) return tz
  return timezoneForCity(city) ?? SERVICE_TIMEZONE_FALLBACK
}

/** True when neither explicit zone nor city map can resolve — silent Moscow risk. */
export function wouldUseTimezoneFallback(
  explicit?: string | null,
  city?: string | null,
): boolean {
  if ((explicit ?? '').trim()) return false
  return timezoneForCity(city) == null
}

/** Device / browser IANA timezone (user-local system clock). */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
