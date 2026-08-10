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

/** Convert `<input type="datetime-local">` value to RFC3339 UTC ISO string. */
export function datetimeLocalToIso(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) {
    throw new Error('invalid datetime-local')
  }
  return d.toISOString()
}
