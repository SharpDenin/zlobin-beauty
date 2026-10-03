import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { EventInput } from '@fullcalendar/core'
import { EmptyState } from '@/shared/ui/EmptyState'
import { formatLocalInTimezone } from '@/shared/lib/time'
import {
  buildDayStrip,
  buildHalfHourSlots,
  calendarColorClass,
  displayRangeToSlotTimes,
  eventOverlapsDay,
  minutesFromMidnight,
  minutesToHHMM,
  type DisplayRange,
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
  displayRange: DisplayRange
  baseRange?: DisplayRange
  rangeExtendedHint?: string | null
  loading?: boolean
  moving?: boolean
  monthMode?: boolean
  intervalSelecting?: boolean
  intervalStartMin?: number | null
  intervalEndMin?: number | null
  onSelectDate: (date: Date) => void
  onToday: () => void
  onPrev: () => void
  onNext: () => void
  onEventClick: (id: string) => void
  onEventLongPress?: (id: string) => void
  onCreateSlot?: (start: Date) => void
  onLongPressEmpty?: (start: Date) => void
  onIntervalSlotTap?: (slotMin: number) => void
  onSaveInterval?: () => void
  onCancelInterval?: () => void
}

function padTime(minutes: number) {
  return minutesToHHMM(minutes)
}

function wallDateAt(selectedDate: Date, ymd: string, startMin: number) {
  const [y, mo, d] = ymd.split('-').map(Number)
  const local = new Date(selectedDate)
  local.setFullYear(y, mo - 1, d)
  local.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0)
  return local
}

export function CalendarMobile({
  events,
  timezone,
  selectedDate,
  hours,
  exceptions,
  displayRange,
  rangeExtendedHint,
  loading,
  moving,
  monthMode,
  intervalSelecting,
  intervalStartMin,
  intervalEndMin,
  onSelectDate,
  onToday,
  onPrev,
  onNext,
  onEventClick,
  onEventLongPress,
  onCreateSlot,
  onLongPressEmpty,
  onIntervalSlotTap,
  onSaveInterval,
  onCancelInterval,
}: Props) {
  const stripRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLElement | null>(null)
  const longPressTimer = useRef<number | null>(null)
  const longPressFired = useRef(false)
  const pressOrigin = useRef<{ x: number; y: number } | null>(null)
  const scrolledOnce = useRef(false)
  const [nowLabel, setNowLabel] = useState(() => formatLocalInTimezone(new Date().toISOString(), timezone))
  const ymd = zonedYmd(selectedDate, timezone)
  const todayYmd = zonedYmd(new Date(), timezone)
  const strip = useMemo(() => buildDayStrip(selectedDate, timezone, 14), [selectedDate, timezone])
  const { fromMin, toMin } = displayRangeToSlotTimes(displayRange)
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
  const slots = useMemo(() => buildHalfHourSlots(fromMin, toMin), [fromMin, toMin])

  useEffect(() => {
    const selected = stripRef.current?.querySelector('[aria-current="date"]')
    selected?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [ymd])

  useEffect(() => {
    if (!isToday) return
    const id = window.setInterval(() => {
      setNowLabel(formatLocalInTimezone(new Date().toISOString(), timezone))
    }, 60_000)
    return () => window.clearInterval(id)
  }, [isToday, timezone])

  useEffect(() => {
    if (loading || monthMode || scrolledOnce.current || dayEvents.length === 0) return
    scrolledOnce.current = true
    requestAnimationFrame(() => {
      const target =
        listRef.current?.querySelector('.cal-now-banner') ??
        listRef.current?.querySelector('.cal-slot-event') ??
        null
      target?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
  }, [loading, monthMode, ymd, dayEvents.length])

  function clearLongPress() {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    pressOrigin.current = null
  }

  function armLongPress(onFire: () => void) {
    clearLongPress()
    longPressFired.current = false
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true
      navigator.vibrate?.(10)
      onFire()
      longPressTimer.current = null
    }, 500)
  }

  function suppressClickIfLongPress(e: { preventDefault: () => void; stopPropagation: () => void }) {
    if (!longPressFired.current) return false
    e.preventDefault()
    e.stopPropagation()
    longPressFired.current = false
    return true
  }

  function onPressMove(e: ReactPointerEvent) {
    const origin = pressOrigin.current
    if (!origin || longPressTimer.current == null) return
    if (Math.abs(e.clientX - origin.x) > 16 || Math.abs(e.clientY - origin.y) > 16) {
      clearLongPress()
    }
  }

  const eventsBySlot = useMemo(() => {
    const map = new Map<number, EventInput[]>()
    for (const e of dayEvents) {
      const m = minutesFromMidnight(new Date(String(e.start)), timezone)
      const slot = Math.floor(m / 30) * 30
      if (slot < fromMin || slot >= toMin) continue
      const list = map.get(slot) ?? []
      list.push(e)
      map.set(slot, list)
    }
    return map
  }, [dayEvents, timezone, fromMin, toMin])

  const monthCells = useMemo(() => {
    if (!monthMode) return []
    const anchor = new Date(selectedDate)
    anchor.setDate(1)
    anchor.setHours(12, 0, 0, 0)
    const startPad = weekdayIndex(anchor, timezone)
    const pad = (startPad + 6) % 7
    const daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate()
    const cells: Array<{ date: Date; ymd: string; day: number; count: number }> = []
    for (let i = 0; i < pad; i++) {
      cells.push({ date: new Date(0), ymd: `pad-${i}`, day: 0, count: 0 })
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(anchor.getFullYear(), anchor.getMonth(), day, 12)
      const cellYmd = zonedYmd(d, timezone)
      const count = events.filter(
        (e) => e.start && e.display !== 'background' && eventOverlapsDay(String(e.start), e.end ? String(e.end) : undefined, cellYmd, timezone),
      ).length
      cells.push({ date: d, ymd: cellYmd, day, count })
    }
    return cells
  }, [monthMode, selectedDate, timezone, events])

  if (monthMode) {
    return (
      <div className="cal-mobile" data-testid="calendar-mobile">
        <header className="cal-mobile-head">
          <div className="cal-mobile-period">
            <p className="eyebrow">Календарь</p>
            <h2 className="cal-mobile-month">{periodLabel}</h2>
          </div>
          <div className="cal-mobile-nav">
            <button type="button" className="btn btn-ghost cal-touch" onClick={onPrev} aria-label="К предыдущему месяцу">←</button>
            <button type="button" className="btn btn-secondary cal-touch" onClick={onToday}>Сегодня</button>
            <button type="button" className="btn btn-ghost cal-touch" onClick={onNext} aria-label="К следующему месяцу">→</button>
          </div>
        </header>
        <div className="cal-month-dots" role="grid" aria-label="Месяц">
          {['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((d) => (
            <span key={d} className="muted" style={{ textAlign: 'center', fontSize: 11 }}>{d}</span>
          ))}
          {monthCells.map((c) =>
            c.day === 0 ? (
              <span key={c.ymd} />
            ) : (
              <button
                key={c.ymd}
                type="button"
                className={`cal-month-cell ${c.ymd === todayYmd ? 'is-today' : ''} ${c.ymd === ymd ? 'is-selected' : ''}`}
                onClick={() => onSelectDate(c.date)}
              >
                <span>{c.day}</span>
                <span className="cal-month-dots-row" aria-hidden>
                  {Array.from({ length: Math.min(3, c.count) }, (_, i) => (
                    <span key={i} className="cal-month-dot" />
                  ))}
                </span>
              </button>
            ),
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="cal-mobile" data-testid="calendar-mobile">
      <header className="cal-mobile-head">
        <div className="cal-mobile-period">
          <p className="eyebrow">Календарь</p>
          <h2 className="cal-mobile-month">{periodLabel}</h2>
        </div>
        <div className="cal-mobile-nav">
          <button type="button" className="btn btn-ghost cal-touch" onClick={onPrev} aria-label="К предыдущей дате">←</button>
          <button type="button" className="btn btn-secondary cal-touch" onClick={onToday}>Сегодня</button>
          <button type="button" className="btn btn-ghost cal-touch" onClick={onNext} aria-label="К следующей дате">→</button>
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

      {rangeExtendedHint ? <p className="cal-outside-banner muted" role="status">{rangeExtendedHint}</p> : null}

      {!loading && !monthMode && !dayOff && dayEvents.length === 0 ? (
        <EmptyState
          title="На этот день записей нет"
          text="Создайте запись или задачу в свободном слоте."
          action={
            onLongPressEmpty || onCreateSlot ? (
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => {
                  const start = wallDateAt(selectedDate, ymd, Math.max(fromMin, hoursToday?.start_minute ?? fromMin))
                  if (onLongPressEmpty) onLongPressEmpty(start)
                  else onCreateSlot?.(start)
                }}
              >
                Создать запись
              </button>
            ) : undefined
          }
        />
      ) : null}

      {intervalSelecting ? (
        <div className="cal-interval-bar" role="status">
          <span>
            {intervalStartMin == null
              ? 'Выберите начало интервала'
              : intervalEndMin == null
                ? `Начало ${padTime(intervalStartMin)} — выберите конец`
                : `${padTime(Math.min(intervalStartMin, intervalEndMin))}–${padTime(Math.max(intervalStartMin, intervalEndMin) + 30)}`}
          </span>
          <div className="row gap">
            {intervalStartMin != null && intervalEndMin != null ? (
              <button type="button" className="btn btn-primary btn-compact" onClick={onSaveInterval}>Сохранить рабочий интервал</button>
            ) : null}
            <button type="button" className="btn btn-ghost btn-compact" onClick={onCancelInterval}>Отмена</button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="cal-slot-grid" aria-busy="true">
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
      ) : (
        <ol className="cal-slot-grid" ref={(el) => { listRef.current = el }}>
          {isToday && nowMin >= fromMin && nowMin < toMin ? (
            <li className="cal-now-banner" aria-current="time" style={{ scrollMarginTop: 120 }}>
              Сейчас {nowLabel}
            </li>
          ) : null}
          {slots.flatMap((slotMin) => {
            const inInterval =
              intervalSelecting &&
              intervalStartMin != null &&
              (intervalEndMin == null
                ? slotMin === intervalStartMin
                : slotMin >= Math.min(intervalStartMin, intervalEndMin) &&
                  slotMin <= Math.max(intervalStartMin, intervalEndMin))
            const bucket = eventsBySlot.get(slotMin) ?? []
            if (bucket.length > 0 && !intervalSelecting) {
              return bucket.map((e) => {
                const start = String(e.start)
                const end = e.end ? String(e.end) : start
                const classes = Array.isArray(e.classNames) ? e.classNames.join(' ') : String(e.classNames ?? '')
                const colorClass = calendarColorClass(String(e.extendedProps?.color ?? ''), String(e.extendedProps?.category ?? 'task'))
                const client = String(e.extendedProps?.clientName ?? '')
                const status = String(e.extendedProps?.statusLabel ?? '')
                return (
                  <li key={String(e.id)} className="cal-slot-row">
                    <time className="cal-slot-time is-dim" dateTime={start}>
                      {formatLocalInTimezone(start, timezone)}
                    </time>
                    <button
                      type="button"
                      className={`cal-slot-event ${classes} ${colorClass}`}
                      style={
                        colorClass === 'cal-color-hex'
                          ? ({ ['--cal-event-accent' as string]: String(e.extendedProps?.colorCss ?? e.extendedProps?.color) } as CSSProperties)
                          : undefined
                      }
                      onClick={(ev) => {
                        if (suppressClickIfLongPress(ev)) return
                        if (e.id) onEventClick(String(e.id))
                      }}
                      onPointerDown={(ev) => {
                        pressOrigin.current = { x: ev.clientX, y: ev.clientY }
                        if (e.id && onEventLongPress) {
                          armLongPress(() => onEventLongPress(String(e.id)))
                        }
                      }}
                      onPointerMove={onPressMove}
                      onPointerUp={clearLongPress}
                      onPointerCancel={clearLongPress}
                      onPointerLeave={clearLongPress}
                      disabled={moving}
                    >
                      <strong>{e.title}</strong>
                      <span className="muted">
                        {formatLocalInTimezone(start, timezone)}–{formatLocalInTimezone(end, timezone)}
                        {client ? ` · ${client}` : ''}
                        {status ? ` · ${status}` : ''}
                      </span>
                    </button>
                  </li>
                )
              })
            }
            const label = padTime(slotMin)
            const weekdayName = new Intl.DateTimeFormat('ru-RU', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long' }).format(selectedDate)
            const openSlot = () => {
              if (intervalSelecting) {
                onIntervalSlotTap?.(slotMin)
                return
              }
              onCreateSlot?.(wallDateAt(selectedDate, ymd, slotMin))
            }
            return [(
              <li key={slotMin} className={`cal-slot-row ${inInterval ? 'is-interval' : ''}`}>
                <button
                  type="button"
                  className={`cal-slot-time ${inInterval ? 'is-interval' : ''}`}
                  onClick={(ev) => {
                    if (suppressClickIfLongPress(ev)) return
                    openSlot()
                  }}
                  onPointerDown={(ev) => {
                    pressOrigin.current = { x: ev.clientX, y: ev.clientY }
                    if (!intervalSelecting) {
                      armLongPress(() => onLongPressEmpty?.(wallDateAt(selectedDate, ymd, slotMin)))
                    }
                  }}
                  onPointerMove={onPressMove}
                  onPointerUp={clearLongPress}
                  onPointerCancel={clearLongPress}
                  onPointerLeave={clearLongPress}
                >
                  {label}
                </button>
                <button
                  type="button"
                  className={`cal-slot-body ${inInterval ? 'is-interval' : ''}`}
                  onClick={(ev) => {
                    if (suppressClickIfLongPress(ev)) return
                    openSlot()
                  }}
                  onPointerDown={(ev) => {
                    pressOrigin.current = { x: ev.clientX, y: ev.clientY }
                    if (!intervalSelecting) {
                      armLongPress(() => onLongPressEmpty?.(wallDateAt(selectedDate, ymd, slotMin)))
                    }
                  }}
                  onPointerMove={onPressMove}
                  onPointerUp={clearLongPress}
                  onPointerCancel={clearLongPress}
                  onPointerLeave={clearLongPress}
                >
                  <span className="muted">
                    {intervalSelecting
                      ? (inInterval ? 'В выбранном интервале' : 'Свободное время')
                      : `Свободное время на ${weekdayName}`}
                  </span>
                  <span className="chev" aria-hidden>›</span>
                </button>
              </li>
            )]
          })}
        </ol>
      )}
    </div>
  )
}
