import { useEffect, useMemo, useRef } from 'react'
import type { EventInput } from '@fullcalendar/core'
import { EmptyState } from '@/shared/ui/EmptyState'
import { formatLocalInTimezone } from '@/shared/lib/time'
import {
  buildDayStrip,
  eventOverlapsDay,
  minutesFromMidnight,
  weekdayIndex,
  zonedYmd,
} from '@/pages/calendar-helpers'

type HoursItem = { weekday: number; start_minute: number; end_minute: number }
type ExceptionItem = { id: string; day: string; is_day_off: boolean }

type Props = {
  events: EventInput[]
  timezone: string
  selectedDate: Date
  hours: HoursItem[]
  exceptions: ExceptionItem[]
  loading?: boolean
  moving?: boolean
  onSelectDate: (date: Date) => void
  onToday: () => void
  onPrev: () => void
  onNext: () => void
  onEventClick: (id: string) => void
  onCreateSlot?: (start: Date) => void
}

function padTime(minutes: number) {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

export function CalendarMobile({
  events,
  timezone,
  selectedDate,
  hours,
  exceptions,
  loading,
  moving,
  onSelectDate,
  onToday,
  onPrev,
  onNext,
  onEventClick,
  onCreateSlot,
}: Props) {
  const stripRef = useRef<HTMLDivElement>(null)
  const ymd = zonedYmd(selectedDate, timezone)
  const todayYmd = zonedYmd(new Date(), timezone)
  const strip = useMemo(() => buildDayStrip(selectedDate, timezone, 14), [selectedDate, timezone])
  const dayEvents = useMemo(
    () =>
      events
        .filter((e) => e.display !== 'background' && e.extendedProps?.kind !== 'work-mode')
        .filter((e) => e.start && eventOverlapsDay(String(e.start), e.end ? String(e.end) : undefined, ymd, timezone))
        .sort((a, b) => String(a.start).localeCompare(String(b.start))),
    [events, ymd, timezone],
  )
  const dayOff = exceptions.some((ex) => ex.is_day_off && (ex.day === ymd || ex.day.startsWith(ymd)))
  const hoursToday = hours.find((h) => h.weekday === weekdayIndex(selectedDate, timezone))
  const isToday = ymd === todayYmd
  const nowMin = isToday ? minutesFromMidnight(new Date(), timezone) : -1
  const periodLabel = new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    month: 'long',
    year: 'numeric',
  }).format(selectedDate)

  useEffect(() => {
    const selected = stripRef.current?.querySelector('[aria-current="date"]')
    selected?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [ymd])

  const timelineRows = useMemo(() => {
    const rows: Array<{ key: string; kind: 'now' } | { key: string; kind: 'event'; event: EventInput }> = []
    let nowPlaced = false
    dayEvents.forEach((e, index) => {
      const startMin = minutesFromMidnight(new Date(String(e.start)), timezone)
      const prevMin = index === 0 ? -1 : minutesFromMidnight(new Date(String(dayEvents[index - 1].start)), timezone)
      if (isToday && !nowPlaced && nowMin >= prevMin && nowMin < startMin) {
        rows.push({ key: 'now', kind: 'now' })
        nowPlaced = true
      }
      rows.push({ key: String(e.id), kind: 'event', event: e })
    })
    if (isToday && !nowPlaced) rows.push({ key: 'now', kind: 'now' })
    return rows
  }, [dayEvents, isToday, nowMin, timezone])

  return (
    <div className="cal-mobile" data-testid="calendar-mobile">
      <header className="cal-mobile-head">
        <div className="cal-mobile-period">
          <p className="eyebrow">Календарь</p>
          <h2 className="cal-mobile-month">{periodLabel}</h2>
        </div>
        <div className="cal-mobile-nav">
          <button type="button" className="btn btn-ghost cal-touch" onClick={onPrev} aria-label="К предыдущей дате">
            ←
          </button>
          <button type="button" className="btn btn-secondary cal-touch" onClick={onToday}>
            Сегодня
          </button>
          <button type="button" className="btn btn-ghost cal-touch" onClick={onNext} aria-label="К следующей дате">
            →
          </button>
        </div>
      </header>

      <div className="cal-day-strip" ref={stripRef} role="listbox" aria-label="Дни">
        {strip.map((d) => {
          const selected = d.ymd === ymd
          return (
            <button
              key={d.ymd}
              type="button"
              role="option"
              aria-selected={selected}
              aria-current={selected ? 'date' : undefined}
              aria-label={`${d.weekday} ${d.day}${d.isToday ? ', сегодня' : ''}`}
              className={`cal-day-chip ${selected ? 'is-selected' : ''} ${d.isToday ? 'is-today' : ''}`}
              onClick={() => onSelectDate(d.date)}
            >
              <span className="cal-day-chip-wd">{d.weekday}</span>
              <span className="cal-day-chip-num">{d.day}</span>
            </button>
          )
        })}
      </div>

      {hours.length === 0 ? (
        <p className="cal-hours-hint muted">Рабочий график не задан</p>
      ) : hoursToday ? (
        <p className="cal-hours-hint muted">
          Рабочие часы {padTime(hoursToday.start_minute)}–{padTime(hoursToday.end_minute)}
        </p>
      ) : (
        <p className="cal-hours-hint muted">Выходной по графику</p>
      )}

      {loading ? (
        <div className="cal-timeline" aria-busy="true">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      ) : dayOff ? (
        <EmptyState
          title="Выходной"
          text="В этот день график закрыт исключением. Можно открыть другой день или добавить личное событие."
          action={
            onCreateSlot ? (
              <button type="button" className="btn" onClick={() => onCreateSlot(selectedDate)}>
                Добавить событие
              </button>
            ) : undefined
          }
        />
      ) : hours.length === 0 && dayEvents.length === 0 ? (
        <EmptyState
          title="Рабочий график пока не задан"
          text="Календарь покажет рабочие часы после того, как мастер сохранит расписание."
        />
      ) : dayEvents.length === 0 ? (
        <>
          {isToday ? (
            <p className="cal-now-banner" aria-current="time">
              Сейчас {formatLocalInTimezone(new Date().toISOString(), timezone)}
            </p>
          ) : null}
          <EmptyState
          title="День свободен"
          text="Записей и блоков планера нет. Свободное рабочее время можно занять событием."
          action={
            onCreateSlot ? (
              <button type="button" className="btn" onClick={() => onCreateSlot(selectedDate)}>
                Добавить событие
              </button>
            ) : undefined
          }
        />
        </>
      ) : (
        <ol className="cal-timeline">
          {timelineRows.map((row) => {
            if (row.kind === 'now') {
              return (
                <li key={row.key} className="cal-now-banner" aria-current="time">
                  Сейчас {formatLocalInTimezone(new Date().toISOString(), timezone)}
                </li>
              )
            }
            const e = row.event
            const start = String(e.start)
            const end = e.end ? String(e.end) : start
            const classes = Array.isArray(e.classNames) ? e.classNames.join(' ') : String(e.classNames ?? '')
            const client = String(e.extendedProps?.clientName ?? '')
            const status = String(e.extendedProps?.statusLabel ?? '')
            const visit = String(e.extendedProps?.visitLabel ?? '')
            return (
              <li key={row.key} className="cal-timeline-item">
                <time className="cal-timeline-hour" dateTime={start}>
                  {formatLocalInTimezone(start, timezone)}
                </time>
                <button
                  type="button"
                  className={`cal-block ${classes}`}
                  onClick={() => e.id && onEventClick(String(e.id))}
                  disabled={moving}
                >
                  <strong>{e.title}</strong>
                  {client ? <span>{client}</span> : null}
                  <span className="muted">
                    {formatLocalInTimezone(start, timezone)}–{formatLocalInTimezone(end, timezone)}
                    {status ? ` · ${status}` : ''}
                  </span>
                  {visit ? <span className="cal-visit-link">{visit}</span> : null}
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
