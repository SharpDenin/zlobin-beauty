import { useMemo, type CSSProperties } from 'react'
import type { EventInput } from '@fullcalendar/core'
import { initials } from '@/shared/lib/initials'
import {
  appointmentToneClass,
  calendarColorClass,
  eventDurationMinutes,
  eventOverlapsDay,
  minutesFromMidnight,
  minutesToHHMM,
  zonedYmd,
} from '@/pages/calendar-helpers'

export type MasterCol = { userId: string; name: string; photoUrl?: string | null }

type Props = {
  masters: MasterCol[]
  events: EventInput[]
  timezone: string
  /** Monday (or week start) of the visible week in wall time. */
  weekStart: Date
  loading?: boolean
  onEventClick: (id: string) => void
  onMasterClick?: (masterUserId: string) => void
}

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const

function eventMasterUserId(e: EventInput): string | null {
  const p = e.extendedProps as { masterUserId?: string; ownerUserId?: string } | undefined
  const raw = p?.masterUserId ?? p?.ownerUserId
  return raw ? String(raw) : null
}

function eventClasses(e: EventInput): string {
  const fromFc = Array.isArray(e.classNames) ? e.classNames.join(' ') : String(e.classNames ?? '')
  if (fromFc.trim()) return fromFc
  const kind = String((e.extendedProps as { kind?: string } | undefined)?.kind ?? '')
  if (kind === 'appointment') {
    return appointmentToneClass(String((e.extendedProps as { status?: string } | undefined)?.status ?? ''))
  }
  if (kind === 'block') {
    const colorClass = calendarColorClass(
      String((e.extendedProps as { color?: string } | undefined)?.color ?? ''),
      String((e.extendedProps as { category?: string } | undefined)?.category ?? 'task'),
    )
    return `is-planner-block ${colorClass}`
  }
  return ''
}

function addDays(d: Date, n: number) {
  const next = new Date(d)
  next.setDate(next.getDate() + n)
  return next
}

function startOfWeekMonday(d: Date, timezone: string) {
  // Build Monday 00:00 in wall calendar sense using zoned YMD of the anchor.
  const ymd = zonedYmd(d, timezone)
  const [y, mo, day] = ymd.split('-').map(Number)
  const local = new Date(d)
  local.setFullYear(y, mo - 1, day)
  local.setHours(12, 0, 0, 0)
  const weekday = local.getDay() // 0 Sun .. 6 Sat
  const delta = weekday === 0 ? -6 : 1 - weekday
  local.setDate(local.getDate() + delta)
  local.setHours(0, 0, 0, 0)
  return local
}

export function weekStartFromDate(d: Date, timezone: string) {
  return startOfWeekMonday(d, timezone)
}

export function CalendarMastersWeek({
  masters,
  events,
  timezone,
  weekStart,
  loading,
  onEventClick,
  onMasterClick,
}: Props) {
  const days = useMemo(() => {
    const start = startOfWeekMonday(weekStart, timezone)
    return Array.from({ length: 7 }, (_, i) => {
      const day = addDays(start, i)
      return { day, ymd: zonedYmd(day, timezone), label: WEEKDAY_LABELS[i] }
    })
  }, [weekStart, timezone])

  const eventsByMasterDay = useMemo(() => {
    const map = new Map<string, EventInput[]>()
    for (const m of masters) {
      for (const d of days) {
        map.set(`${m.userId}:${d.ymd}`, [])
      }
    }
    for (const e of events) {
      if (e.display === 'background') continue
      const mid = eventMasterUserId(e)
      if (!mid || !e.start) continue
      const kind = String((e.extendedProps as { kind?: string } | undefined)?.kind ?? '')
      if (kind === 'work-mode') continue
      for (const d of days) {
        if (!eventOverlapsDay(String(e.start), e.end ? String(e.end) : undefined, d.ymd, timezone)) continue
        const key = `${mid}:${d.ymd}`
        const list = map.get(key)
        if (list) list.push(e)
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => String(a.start).localeCompare(String(b.start)))
    }
    return map
  }, [masters, days, events, timezone])

  if (loading) {
    return (
      <div className="cal-masters-week" data-testid="calendar-masters-week" aria-busy="true">
        <div className="skeleton skeleton-card" style={{ minHeight: 240 }} />
      </div>
    )
  }

  if (masters.length === 0) {
    return (
      <div className="cal-masters-week state-box" data-testid="calendar-masters-week">
        Нет мастеров для выбранного филиала.
      </div>
    )
  }

  return (
    <div className="cal-masters-week" data-testid="calendar-masters-week">
      <div className="cal-masters-week-scroll">
        <div
          className="cal-masters-week-board"
          style={{ ['--cal-masters-week-cols' as string]: String(masters.length) } as CSSProperties}
        >
          <div className="cal-masters-week-head" role="row">
            {masters.map((m) => (
              <div key={m.userId} className="cal-masters-week-col-head" role="columnheader">
                <button
                  type="button"
                  className="cal-masters-week-master-btn cal-touch"
                  data-testid={`calendar-master-open-${m.userId}`}
                  onClick={() => onMasterClick?.(m.userId)}
                  aria-label={`Открыть карточку мастера ${m.name}`}
                >
                  {m.photoUrl ? (
                    <img className="cal-masters-avatar" src={m.photoUrl} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <span className="cal-masters-avatar cal-masters-avatar--initials" aria-hidden>
                      {initials(m.name)}
                    </span>
                  )}
                  <span className="cal-masters-name">{m.name}</span>
                </button>
              </div>
            ))}
          </div>

          <div className="cal-masters-week-body">
            {masters.map((m) => (
              <div key={m.userId} className="cal-masters-week-col" data-testid={`calendar-week-col-${m.userId}`}>
                {days.map((d) => {
                  const list = eventsByMasterDay.get(`${m.userId}:${d.ymd}`) ?? []
                  const dayNum = d.ymd.slice(8)
                  return (
                    <section key={d.ymd} className="cal-masters-week-day">
                      <header className="cal-masters-week-day-head">
                        <span className="cal-masters-week-day-label">{d.label}</span>
                        <span className="muted">{dayNum}</span>
                      </header>
                      <div className="cal-masters-week-day-events">
                        {list.length === 0 ? (
                          <p className="muted cal-masters-week-empty">—</p>
                        ) : (
                          list.map((e) => {
                            const startIso = String(e.start)
                            const endIso = e.end ? String(e.end) : undefined
                            const startMin = minutesFromMidnight(new Date(startIso), timezone)
                            const endMin = startMin + eventDurationMinutes(startIso, endIso, timezone)
                            const title = String(e.title ?? 'Событие')
                            const classes = eventClasses(e)
                            return (
                              <button
                                key={String(e.id)}
                                type="button"
                                className={`cal-masters-week-event ${classes}`}
                                onClick={() => onEventClick(String(e.id))}
                              >
                                <span className="cal-masters-week-event-time">
                                  {minutesToHHMM(startMin)}–{minutesToHHMM(endMin)}
                                </span>
                                <span className="cal-masters-week-event-title">{title}</span>
                              </button>
                            )
                          })
                        )}
                      </div>
                    </section>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
