export function isTerminalStatus(status?: string) {
  if (!status) return false
  return status === 'completed' || status === 'no_show' || status.startsWith('cancelled_')
}

export function canDragAppointment(status?: string, bookingMode?: string) {
  if (bookingMode === 'fixed_window') return false
  return status === 'pending_confirmation' || status === 'confirmed'
}

export function minutesToTime(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

export function minutesToHHMM(minutes: number) {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(minutes)))
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function parseHHMM(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 24 || min < 0 || min > 59) return null
  if (h === 24 && min !== 0) return null
  return h * 60 + min
}

export function snapMinutes(value: number, step = 30) {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

export type DisplayRange = { from: string; to: string }

export const DEFAULT_DISPLAY_RANGE: DisplayRange = { from: '08:00', to: '22:00' }

/** Validate display range: from < to, min span 4h, 30-min snap. Returns normalized or error. */
export function validateDisplayRange(from: string, to: string): { ok: true; value: DisplayRange } | { ok: false; error: string } {
  let fromMin = parseHHMM(from)
  let toMin = parseHHMM(to)
  if (fromMin == null || toMin == null) {
    return { ok: false, error: 'Укажите время в формате ЧЧ:ММ' }
  }
  fromMin = snapMinutes(fromMin, 30)
  toMin = snapMinutes(toMin, 30)
  if (toMin <= fromMin) {
    return { ok: false, error: 'Конец отображения должен быть позже начала' }
  }
  if (toMin - fromMin < 4 * 60) {
    return { ok: false, error: 'Диапазон отображения — не меньше 4 часов' }
  }
  return { ok: true, value: { from: minutesToHHMM(fromMin), to: minutesToHHMM(toMin) } }
}

export function displayRangeToSlotTimes(range: DisplayRange) {
  const fromMin = parseHHMM(range.from) ?? 8 * 60
  const toMin = parseHHMM(range.to) ?? 22 * 60
  return { slotMinTime: minutesToTime(fromMin), slotMaxTime: minutesToTime(toMin), fromMin, toMin }
}

export function extendDisplayRangeForEvents(
  base: DisplayRange,
  eventMinutes: number[],
): DisplayRange {
  const validated = validateDisplayRange(base.from, base.to)
  const value = validated.ok ? validated.value : DEFAULT_DISPLAY_RANGE
  let fromMin = parseHHMM(value.from) ?? 8 * 60
  let toMin = parseHHMM(value.to) ?? 22 * 60
  for (const m of eventMinutes) {
    if (!Number.isFinite(m)) continue
    if (m < fromMin) fromMin = snapMinutes(Math.max(0, m - 30), 30)
    if (m > toMin) toMin = snapMinutes(Math.min(24 * 60, m + 30), 30)
  }
  if (toMin - fromMin < 4 * 60) toMin = fromMin + 4 * 60
  return { from: minutesToHHMM(fromMin), to: minutesToHHMM(Math.min(24 * 60, toMin)) }
}

export function countEventsOutsideRange(
  startsMinutes: number[],
  fromMin: number,
  toMin: number,
): { earlier: number; later: number } {
  let earlier = 0
  let later = 0
  for (const m of startsMinutes) {
    if (m < fromMin) earlier += 1
    else if (m >= toMin) later += 1
  }
  return { earlier, later }
}

export const CALENDAR_COLOR_TOKENS = [
  'primary',
  'success',
  'warning',
  'danger',
  'info',
  'neutral',
  'violet',
  'teal',
  'rose',
  'amber',
] as const

export type CalendarColorToken = (typeof CALENDAR_COLOR_TOKENS)[number]

export const CALENDAR_COLOR_LABELS: Record<CalendarColorToken, string> = {
  primary: 'Фиолетовый',
  success: 'Зелёный',
  warning: 'Жёлтый',
  danger: 'Красный',
  info: 'Синий',
  neutral: 'Серый',
  violet: 'Сиреневый',
  teal: 'Бирюзовый',
  rose: 'Розовый',
  amber: 'Янтарный',
}

const TOKEN_SET = new Set<string>(CALENDAR_COLOR_TOKENS)

const TOKEN_CSS: Record<string, string> = {
  primary: 'var(--color-primary)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  info: 'var(--color-info)',
  neutral: 'var(--color-text-secondary)',
  violet: 'var(--color-primary-soft)',
  teal: 'var(--color-success)',
  rose: 'var(--color-danger)',
  amber: 'var(--color-warning)',
}

const CATEGORY_DEFAULT_TOKEN: Record<string, CalendarColorToken> = {
  client: 'primary',
  personal: 'neutral',
  break: 'info',
  blocked: 'danger',
  task: 'success',
  delivery: 'teal',
  salon_visit: 'teal',
  operational: 'warning',
  staff: 'violet',
}

export function defaultColorForCategory(categoryId: string): CalendarColorToken {
  return CATEGORY_DEFAULT_TOKEN[categoryId] ?? 'primary'
}

/** Normalize stored/API color to a token id or legacy hex. */
export function normalizeCalendarColor(input: string | undefined | null, categoryId = 'task'): string {
  const raw = String(input ?? '').trim()
  if (!raw) return defaultColorForCategory(categoryId)
  const lower = raw.toLowerCase()
  if (TOKEN_SET.has(lower)) return lower
  const varMatch = /^var\(--color-([a-z0-9-]+)\)$/i.exec(raw)
  if (varMatch) {
    let key = varMatch[1].replace(/-soft$|-muted$|-hover$|-ink$/, '')
    if (key === 'text-secondary') key = 'neutral'
    if (TOKEN_SET.has(key)) return key
    return defaultColorForCategory(categoryId)
  }
  if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return lower
  // Legacy CSS var stored without wrapping
  if (TOKEN_SET.has(lower.replace(/^color-/, ''))) return lower.replace(/^color-/, '')
  return defaultColorForCategory(categoryId)
}

/** CSS color value (token → CSS var, hex kept). */
export function calendarColorCss(color: string | undefined | null, categoryId = 'task'): string {
  const id = normalizeCalendarColor(color, categoryId)
  if (TOKEN_CSS[id]) return TOKEN_CSS[id]
  if (id.startsWith('#')) return id
  return TOKEN_CSS.primary
}

export function calendarColorClass(color: string | undefined | null, categoryId = 'task'): string {
  const id = normalizeCalendarColor(color, categoryId)
  if (TOKEN_SET.has(id)) return `cal-color-${id}`
  return 'cal-color-hex'
}

export function staffRoleLabel(role?: string) {
  if (role === 'owner') return 'Владелец'
  if (role === 'admin') return 'Администратор'
  if (role === 'master') return 'Мастер'
  return 'Сотрудник'
}

export function appointmentToneClass(status?: string) {
  if (!status) return 'is-appt'
  if (isTerminalStatus(status)) return 'is-appt is-terminal'
  if (status === 'confirmed' || status === 'in_progress') return 'is-appt is-busy'
  if (status === 'pending_confirmation') return 'is-appt is-pending'
  return 'is-appt'
}

export function weekdayIndex(date: Date, timeZone: string) {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date)
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name)
  } catch {
    return date.getDay()
  }
}

export function zonedYmd(date: Date, timeZone: string) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  } catch {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  }
}

export function weekdayShortRu(date: Date, timeZone: string) {
  try {
    return new Intl.DateTimeFormat('ru-RU', { timeZone, weekday: 'short' }).format(date).replace('.', '')
  } catch {
    return new Intl.DateTimeFormat('ru-RU', { weekday: 'short' }).format(date).replace('.', '')
  }
}

export type DayStripItem = { date: Date; ymd: string; weekday: string; day: number; isToday: boolean }

export function buildDayStrip(anchor: Date, timeZone: string, days = 14): DayStripItem[] {
  const today = zonedYmd(new Date(), timeZone)
  const start = new Date(anchor.getTime())
  start.setHours(12, 0, 0, 0)
  start.setDate(start.getDate() - 3)
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const ymd = zonedYmd(d, timeZone)
    return {
      date: d,
      ymd,
      weekday: weekdayShortRu(d, timeZone),
      day: Number(new Intl.DateTimeFormat('ru-RU', { timeZone, day: 'numeric' }).format(d)),
      isToday: ymd === today,
    }
  })
}

export function eventOverlapsDay(startIso: string, endIso: string | undefined, ymd: string, timeZone: string) {
  const start = new Date(startIso)
  const end = endIso ? new Date(endIso) : new Date(start.getTime() + 30 * 60 * 1000)
  if (Number.isNaN(start.getTime())) return false
  return zonedYmd(start, timeZone) === ymd || zonedYmd(end, timeZone) === ymd
}

export function visitCompanionTitle(serviceName: string, groupNames: string[]) {
  const rest = groupNames.filter((n) => n !== serviceName)
  if (!rest.length) return ''
  return rest.join(' → ')
}

export function minutesFromMidnight(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

/** Horizontal swipe that won't fight vertical scroll / drag. */
/** Day swipe only on compact day view; week/month always move by period. */
export function swipeStep(view: CalendarViewId, compact: boolean): 'day' | 'period' {
  if (compact && view === 'timeGridDay') return 'day'
  return 'period'
}

export function detectHorizontalSwipe(
  dx: number,
  dy: number,
  opts?: { minDx?: number; maxDyRatio?: number },
): 'left' | 'right' | null {
  const minDx = opts?.minDx ?? 56
  const maxDyRatio = opts?.maxDyRatio ?? 0.65
  const absX = Math.abs(dx)
  const absY = Math.abs(dy)
  if (absX < minDx) return null
  if (absY > absX * maxDyRatio) return null
  return dx < 0 ? 'left' : 'right'
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export type CalendarViewId = 'timeGridDay' | 'timeGridWeek' | 'timeGridThreeDay' | 'dayGridMonth' | 'listWeek'

export function isCalendarViewId(v: string): v is CalendarViewId {
  return (
    v === 'timeGridDay' ||
    v === 'timeGridWeek' ||
    v === 'timeGridThreeDay' ||
    v === 'dayGridMonth' ||
    v === 'listWeek'
  )
}

/** Map a date range to a single-day schedule-exception interval (end at midnight → 1440). */
export function rangeToDayInterval(
  start: Date,
  end: Date,
  timeZone: string,
): { day: string; start_minute: number; end_minute: number } | null {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
    return null
  }
  const day = zonedYmd(start, timeZone)
  const endDay = zonedYmd(end, timeZone)
  const startMinute = minutesFromMidnight(start, timeZone)
  let endMinute = minutesFromMidnight(end, timeZone)
  if (endDay !== day) {
    // Only accept exclusive midnight on a later day as end-of-day (1440).
    if (endMinute !== 0) return null
    endMinute = 1440
  }
  if (endMinute <= startMinute || startMinute < 0 || endMinute > 1440) return null
  return { day, start_minute: startMinute, end_minute: endMinute }
}

export function buildHalfHourSlots(fromMin: number, toMin: number): number[] {
  const out: number[] = []
  for (let m = fromMin; m < toMin; m += 30) out.push(m)
  return out
}
