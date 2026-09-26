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
