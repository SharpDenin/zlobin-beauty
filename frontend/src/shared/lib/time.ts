const timeOpts: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
}

const dateTimeOpts: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
}

/** Format an ISO instant in a specific IANA timezone. */
export function formatLocalInTimezone(
  iso: string,
  iana: string,
  options: Intl.DateTimeFormatOptions = timeOpts,
): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const tz = iana.trim() || undefined
  try {
    return new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: tz }).format(date)
  } catch {
    return new Intl.DateTimeFormat('ru-RU', options).format(date)
  }
}

export function formatDateTimeInTimezone(iso: string, iana: string): string {
  return formatLocalInTimezone(iso, iana, dateTimeOpts)
}

export function formatRangeInTimezone(startsAt: string, endsAt: string, iana: string): string {
  const start = formatLocalInTimezone(startsAt, iana, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  const end = formatLocalInTimezone(endsAt, iana, timeOpts)
  return `${start} – ${end}`
}

/**
 * Primary label in salon timezone + optional client-local hint when zones differ.
 * Example: "14:00 по местному времени салона · у вас 10:00"
 */
export function formatDualTime(
  iso: string,
  salonTz: string,
  options?: { includeClientLocal?: boolean; withDate?: boolean },
): string {
  const includeClient = options?.includeClientLocal !== false
  const fmt = options?.withDate ? dateTimeOpts : timeOpts
  const salon = formatLocalInTimezone(iso, salonTz, fmt)
  let result = `${salon} по местному времени салона`

  if (!includeClient) return result

  const clientTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (clientTz && salonTz && clientTz !== salonTz) {
    const client = new Date(iso).toLocaleString('ru-RU', fmt)
    result += ` · у вас ${client}`
  }
  return result
}

/**
 * Convert `<input type="datetime-local">` (wall clock, no zone) to RFC3339 UTC.
 * Interprets the wall time in `iana` (salon/branch timezone), NOT the browser zone.
 * Example: "2026-08-20T14:00" in Asia/Krasnoyarsk → correct UTC instant.
 */
export function datetimeLocalToIso(value: string, iana?: string): string {
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) {
    throw new Error('invalid datetime-local')
  }
  const [datePart, timePart] = trimmed.split('T')
  const [y, mo, d] = datePart.split('-').map(Number)
  const [hh, mm, ss = '0'] = timePart.split(':')
  const hour = Number(hh)
  const minute = Number(mm)
  const second = Number(String(ss).slice(0, 2)) || 0
  const tz = (iana ?? '').trim()
  if (!tz) {
    // Explicit fallback only when caller has no location TZ — still better than silent browser TZ.
    const utc = Date.UTC(y, mo - 1, d, hour, minute, second)
    return new Date(utc).toISOString()
  }
  return wallTimeInTimezoneToUtcIso(y, mo, d, hour, minute, second, tz)
}

/** Binary-search UTC instant whose local wall clock in `tz` matches the given components. */
export function wallTimeInTimezoneToUtcIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  tz: string,
): string {
  const target = { year, month, day, hour, minute, second }
  // Rough guess: treat as UTC then adjust.
  let guess = Date.UTC(year, month - 1, day, hour, minute, second)
  for (let i = 0; i < 4; i++) {
    const parts = getTzParts(new Date(guess), tz)
    const deltaMin =
      (target.year - parts.year) * 525600 +
      (target.month - parts.month) * 43200 +
      (target.day - parts.day) * 1440 +
      (target.hour - parts.hour) * 60 +
      (target.minute - parts.minute) +
      (target.second - parts.second) / 60
    if (Math.abs(deltaMin) < 1 / 60) break
    guess += deltaMin * 60_000
  }
  // Final snap: if still off by DST ambiguity, prefer the later offset match.
  const finalParts = getTzParts(new Date(guess), tz)
  if (
    finalParts.year !== year ||
    finalParts.month !== month ||
    finalParts.day !== day ||
    finalParts.hour !== hour ||
    finalParts.minute !== minute
  ) {
    throw new Error(`cannot interpret wall time in timezone ${tz}`)
  }
  return new Date(guess).toISOString()
}

/** Interpret a JS Date's *wall clock* (year/month/day/hour/minute) in `iana`, not the browser zone. */
export function dateWallToIso(d: Date, iana: string): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const wall = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return datetimeLocalToIso(wall, iana)
}

/** Format an ISO instant as datetime-local wall clock in `iana`. */
export function isoToDatetimeLocal(iso: string, iana: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const parts = getTzParts(date, iana.trim() || 'UTC')
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`
}

function getTzParts(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const map: Record<string, string> = {}
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = p.value
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  }
}
