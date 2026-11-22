import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import type { EventInput } from '@fullcalendar/core'
import { EmptyState } from '@/shared/ui/EmptyState'
import { AppIcon } from '@/shared/ui/AppIcon'
import { formatLocalInTimezone } from '@/shared/lib/time'
import {
  buildDayStrip,
  buildHalfHourSlots,
  calendarColorClass,
  canDragAppointment,
  eventCoversSlot,
  eventDurationMinutes,
  eventOverlapsDay,
  eventSlotSpan,
  formatCalendarNowLabel,
  LONG_PRESS_MS,
  longPressMoved,
  minutesFromMidnight,
  minutesToHHMM,
  resolveDayWorkWindow,
  weekdayIndex,
  zonedYmd,
  type DisplayRange,
} from '@/pages/calendar-helpers'
import {
  attachResizePointerSession,
  findCalendarScrollRoots,
  isShortResizeShell,
  lockCalendarGesture,
  resizeDraftValid,
  type ResizeDraft,
  type ResizeEdge,
} from '@/pages/calendar-event-resize'

const MOBILE_SLOT_PX = 52

type HoursItem = { weekday: number; start_minute: number; end_minute: number }
type ExceptionItem = { id: string; day: string; is_day_off: boolean; start_minute?: number | null; end_minute?: number | null }

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
  heading?: string
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
  onEventResize?: (id: string, startMin: number, endMin: number) => void | Promise<void>
  canResizeEvent?: (event: EventInput) => boolean
}

function padTime(minutes: number) {
  return minutesToHHMM(minutes)
}

function defaultCanResize(e: EventInput) {
  const p = e.extendedProps as { readonly?: boolean; kind?: string; status?: string; bookingMode?: string } | undefined
  if (p?.readonly) return false
  if (e.display === 'background' || p?.kind === 'work-mode') return false
  if (p?.kind === 'appointment') {
    return canDragAppointment(String(p.status ?? ''), String(p.bookingMode ?? ''))
  }
  return true
}

function eventDayMinutes(e: EventInput, timezone: string) {
  const startIso = String(e.start)
  const endIso = e.end ? String(e.end) : undefined
  const startMin = minutesFromMidnight(new Date(startIso), timezone)
  const endMin = startMin + eventDurationMinutes(startIso, endIso, timezone)
  return { startMin, endMin }
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
  rangeExtendedHint,
  loading,
  moving,
  monthMode,
  heading = 'Расписание',
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
  onEventResize,
  canResizeEvent,
}: Props) {
  const stripRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLElement | null>(null)
  const dateInputRef = useRef<HTMLInputElement>(null)
  const longPressTimer = useRef<number | null>(null)
  const longPressFired = useRef(false)
  const resizeJustFinished = useRef(false)
  const pressOrigin = useRef<{ x: number; y: number } | null>(null)
  const resizeBase = useRef<{ id: string; edge: ResizeEdge; startMin: number; endMin: number } | null>(null)
  const resizeCleanup = useRef<(() => void) | null>(null)
  const gestureUnlock = useRef<(() => void) | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const scrolledOnce = useRef(false)
  const [resizeDraft, setResizeDraft] = useState<ResizeDraft | null>(null)
  // Label = device clock (+ scale hint when zones differ). Position = service TZ.
  const [nowLabel, setNowLabel] = useState(() => formatCalendarNowLabel(new Date(), timezone))
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
  const work = useMemo(
    () => resolveDayWorkWindow(ymd, weekdayIndex(selectedDate, timezone), hours, exceptions),
    [ymd, selectedDate, timezone, hours, exceptions],
  )
  const isToday = ymd === todayYmd
  // Marker position follows the service-location timeline so it aligns with slots.
  const nowMin = isToday ? minutesFromMidnight(new Date(), timezone) : -1
  const periodLabel = new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    month: 'long',
    year: 'numeric',
  }).format(selectedDate)
  const dayContextLabel = new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(selectedDate)

  const slots = useMemo(() => {
    if (work.status !== 'open') return [] as number[]
    return buildHalfHourSlots(work.startMin, work.endMin)
  }, [work])

  useEffect(() => {
    scrolledOnce.current = false
  }, [ymd])

  useEffect(() => {
    const selected = stripRef.current?.querySelector('[aria-current="date"]')
    selected?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [ymd])

  useEffect(() => {
    if (!isToday) return
    const tick = () => setNowLabel(formatCalendarNowLabel(new Date(), timezone))
    tick()
    const id = window.setInterval(tick, 60_000)
    return () => window.clearInterval(id)
  }, [isToday, timezone])

  useEffect(() => {
    return () => {
      resizeCleanup.current?.()
      resizeCleanup.current = null
      gestureUnlock.current?.()
      gestureUnlock.current = null
    }
  }, [])

  useEffect(() => {
    if (loading || monthMode || scrolledOnce.current || slots.length === 0) return
    scrolledOnce.current = true
    requestAnimationFrame(() => {
      const target =
        listRef.current?.querySelector('.cal-now-banner') ??
        listRef.current?.querySelector('.cal-slot-event') ??
        listRef.current?.querySelector('.cal-slot-row.is-free') ??
        null
      target?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
  }, [loading, monthMode, ymd, slots.length])

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
    }, LONG_PRESS_MS)
  }

  function suppressClickIfLongPress(e: { preventDefault: () => void; stopPropagation: () => void }) {
    if (resizeJustFinished.current) {
      e.preventDefault()
      e.stopPropagation()
      resizeJustFinished.current = false
      return true
    }
    if (!longPressFired.current) return false
    e.preventDefault()
    e.stopPropagation()
    longPressFired.current = false
    return true
  }

  function beginCalResize() {
    gestureUnlock.current?.()
    gestureUnlock.current = lockCalendarGesture(findCalendarScrollRoots(rootRef.current))
    document.body.dataset.calGestureLockSource = 'custom-resize-pointerdown'
  }

  function endCalResize() {
    resizeCleanup.current?.()
    resizeCleanup.current = null
    gestureUnlock.current?.()
    gestureUnlock.current = null
    delete document.body.dataset.calGestureLockSource
    resizeBase.current = null
    setResizeDraft(null)
  }

  function onResizeHandleDown(
    e: ReactPointerEvent<HTMLSpanElement>,
    edge: ResizeEdge,
    eid: string,
    startMin: number,
    endMin: number,
  ) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    clearLongPress()
    resizeCleanup.current?.()
    resizeBase.current = { id: eid, edge, startMin, endMin }
    setResizeDraft({ id: eid, edge, startMin, endMin })
    beginCalResize()
    const captureEl = e.currentTarget
    try {
      captureEl.setPointerCapture(e.pointerId)
    } catch {
      /* some WebViews reject capture; window listeners still drive the gesture */
    }
    resizeCleanup.current = attachResizePointerSession(
      {
        pointerId: e.pointerId,
        edge,
        id: eid,
        startMin,
        endMin,
        originY: e.clientY,
        slotPx: MOBILE_SLOT_PX,
        captureTarget: captureEl,
      },
      {
        onMove: (next) => setResizeDraft({ id: eid, edge, ...next }),
        onEnd: (next) => {
          const base = resizeBase.current
          const draft: ResizeDraft = { id: eid, edge, ...next }
          endCalResize()
          if (!base || !resizeDraftValid(draft)) return
          const changed = draft.startMin !== base.startMin || draft.endMin !== base.endMin
          if (changed && onEventResize) {
            resizeJustFinished.current = true
            void onEventResize(draft.id, draft.startMin, draft.endMin)
          }
        },
        onCancel: () => {
          endCalResize()
        },
      },
    )
  }

  function onPressMove(e: ReactPointerEvent) {
    const origin = pressOrigin.current
    if (!origin || longPressTimer.current == null) return
    if (longPressMoved(e.clientX - origin.x, e.clientY - origin.y)) {
      clearLongPress()
    }
  }

  function openDatePicker() {
    const input = dateInputRef.current
    if (!input) return
    try {
      input.showPicker?.()
    } catch {
      input.click()
    }
  }

  function onDateInputChange(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return
    const [y, mo, d] = value.split('-').map(Number)
    const next = new Date(selectedDate)
    next.setFullYear(y, mo - 1, d)
    next.setHours(12, 0, 0, 0)
    onSelectDate(next)
  }

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
        <header className="cal-mobile-head cal-mobile-head--month">
          <div className="cal-mobile-period">
            <p className="eyebrow">{heading}</p>
            <h2 className="cal-mobile-month">{periodLabel}</h2>
          </div>
          <div className="cal-mobile-nav cal-mobile-day-nav">
            <button type="button" className="btn btn-ghost btn-compact cal-touch" onClick={onPrev} aria-label="К предыдущему месяцу">Назад</button>
            <button type="button" className="btn btn-secondary btn-compact cal-touch" onClick={onToday}>Сегодня</button>
            <button type="button" className="btn btn-ghost btn-compact cal-touch" onClick={onNext} aria-label="К следующему месяцу">Вперёд</button>
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
                onPointerDown={(e) => {
                  if (e.pointerType === 'mouse' && e.button !== 0) return
                  pressOrigin.current = { x: e.clientX, y: e.clientY }
                  armLongPress(() => {
                    const start = wallDateAt(c.date, c.ymd, hours.find((h) => h.weekday === weekdayIndex(c.date, timezone))?.start_minute ?? 10 * 60)
                    onLongPressEmpty?.(start)
                  })
                }}
                onPointerMove={onPressMove}
                onPointerUp={() => clearLongPress()}
                onPointerCancel={() => clearLongPress()}
                onClick={(e) => {
                  if (suppressClickIfLongPress(e)) return
                  onSelectDate(c.date)
                  if (c.count > 0) {
                    const cellEvents = events.filter(
                      (ev) =>
                        ev.id
                        && ev.start
                        && ev.display !== 'background'
                        && eventOverlapsDay(String(ev.start), ev.end ? String(ev.end) : undefined, c.ymd, timezone),
                    )
                    if (cellEvents.length === 1 && cellEvents[0].id && onEventLongPress) {
                      onEventLongPress(String(cellEvents[0].id))
                    }
                  }
                }}
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

  const freeSlotLabel = intervalSelecting
    ? undefined
    : `Свободное время · ${dayContextLabel}`

  return (
    <div
      ref={rootRef}
      className={`cal-mobile cal-mobile--day${resizeDraft ? ' is-cal-resizing' : ''}`}
      data-testid="calendar-mobile"
      data-day-list="true"
    >
      <div className="cal-mobile-chrome">
        <header className="cal-mobile-head cal-mobile-head--day">
          <div className="cal-mobile-day-nav" role="group" aria-label="Навигация по дате">
            <button type="button" className="btn btn-ghost btn-compact cal-touch" onClick={onPrev} aria-label="Назад">
              Назад
            </button>
            <button type="button" className="btn btn-secondary btn-compact cal-touch" onClick={onToday}>
              Сегодня
            </button>
            <button type="button" className="btn btn-ghost btn-compact cal-touch" onClick={onNext} aria-label="Вперёд">
              Вперёд
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-icon cal-date-picker-btn cal-touch"
              aria-label={`Выбрать дату, ${dayContextLabel}`}
              data-testid="calendar-mobile-date-picker"
              onClick={openDatePicker}
            >
              <AppIcon name="calendar" size={18} />
            </button>
            <input
              ref={dateInputRef}
              type="date"
              className="visually-hidden"
              value={ymd}
              onChange={(e) => onDateInputChange(e.target.value)}
              tabIndex={-1}
              aria-hidden
            />
          </div>
          <p className="cal-mobile-day-label" aria-live="polite">
            <span className="visually-hidden">{heading}. </span>
            {dayContextLabel}
          </p>
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
      </div>

      <div className="cal-mobile-body">
      {rangeExtendedHint ? <p className="cal-outside-banner muted" role="status">{rangeExtendedHint}</p> : null}

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
      ) : work.status === 'unset' && dayEvents.length === 0 ? (
        <EmptyState
          title="Рабочий график пока не задан"
          text="Календарь покажет рабочие часы после того, как мастер сохранит расписание."
        />
      ) : work.status === 'day_off' && dayEvents.length === 0 ? (
        <EmptyState
          title="Выходной"
          text="В этот день график закрыт. Можно открыть другой день или добавить личное событие."
          action={
            onCreateSlot ? (
              <button type="button" className="btn" onClick={() => onCreateSlot(selectedDate)}>
                Добавить событие
              </button>
            ) : undefined
          }
        />
      ) : (
        <ol className="cal-slot-grid" ref={(el) => { listRef.current = el }} aria-label={`Слоты на ${dayContextLabel}`}>
          {work.status === 'day_off' ? (
            <li className="cal-hours-hint muted" role="status">Выходной по графику — показаны существующие события</li>
          ) : null}
          {(work.status === 'day_off' && slots.length === 0
            ? Array.from(
                new Set(
                  dayEvents.map((e) => {
                    const m = minutesFromMidnight(new Date(String(e.start)), timezone)
                    return Math.floor(m / 30) * 30
                  }),
                ),
              ).sort((a, b) => a - b)
            : slots
          ).flatMap((slotMin) => {
            const rows: ReactElement[] = []
            const showNow =
              isToday &&
              work.status === 'open' &&
              nowMin >= slotMin &&
              nowMin < slotMin + 30 &&
              nowMin >= work.startMin &&
              nowMin < work.endMin

            if (showNow) {
              rows.push(
                <li
                  key={`now-${slotMin}`}
                  className="cal-now-marker"
                  aria-current="time"
                  data-testid="calendar-now-marker"
                  style={{ scrollMarginTop: 96 }}
                >
                  <span className="cal-now-marker-line" aria-hidden />
                  <span className="cal-now-marker-label">{nowLabel}</span>
                </li>,
              )
            }

            const inInterval =
              intervalSelecting &&
              intervalStartMin != null &&
              (intervalEndMin == null
                ? slotMin === intervalStartMin
                : slotMin >= Math.min(intervalStartMin, intervalEndMin) &&
                  slotMin <= Math.max(intervalStartMin, intervalEndMin))

            const covering = dayEvents.filter((e) =>
              eventCoversSlot(String(e.start), e.end ? String(e.end) : undefined, slotMin, timezone),
            )
            const startingHere = covering.filter((e) => {
              const startMin = minutesFromMidnight(new Date(String(e.start)), timezone)
              return Math.floor(startMin / 30) * 30 === slotMin
            })

            if (startingHere.length > 0 && !intervalSelecting) {
              for (const e of startingHere) {
                const start = String(e.start)
                const end = e.end ? String(e.end) : start
                const eid = String(e.id)
                const dayMins = eventDayMinutes(e, timezone)
                const isResizing = resizeDraft?.id === eid
                const liveStart = isResizing ? resizeDraft!.startMin : dayMins.startMin
                const liveEnd = isResizing ? resizeDraft!.endMin : dayMins.endMin
                const span = isResizing
                  ? Math.max(1, Math.ceil((liveEnd - liveStart) / 30))
                  : eventSlotSpan(start, end, timezone)
                const showResizeHandles = !monthMode && !intervalSelecting && (canResizeEvent?.(e) ?? defaultCanResize(e))
                const classes = Array.isArray(e.classNames) ? e.classNames.join(' ') : String(e.classNames ?? '')
                const colorClass = calendarColorClass(String(e.extendedProps?.color ?? ''), String(e.extendedProps?.category ?? 'task'))
                const client = String(e.extendedProps?.clientName ?? '')
                const status = String(e.extendedProps?.statusLabel ?? '')
                const timeLabel = isResizing
                  ? `${minutesToHHMM(liveStart)}–${minutesToHHMM(liveEnd)}`
                  : (() => {
                      const eventTz = String((e.extendedProps as { timezone?: string } | undefined)?.timezone || timezone)
                      return `${formatLocalInTimezone(start, eventTz)}–${formatLocalInTimezone(end, eventTz)}`
                    })()
                const accentStyle =
                  colorClass === 'cal-color-hex'
                    ? ({
                        ['--cal-event-accent' as string]: String(e.extendedProps?.colorCss ?? e.extendedProps?.color),
                        ['--cal-event-span' as string]: String(span),
                      } as CSSProperties)
                    : ({ ['--cal-event-span' as string]: String(span) } as CSSProperties)
                rows.push(
                  <li
                    key={String(e.id)}
                    className="cal-slot-row is-busy is-event-span"
                    data-testid="calendar-event-span"
                    data-span={span}
                    style={accentStyle}
                  >
                    <time className="cal-slot-time is-busy" dateTime={start}>
                      {padTime(isResizing ? liveStart : slotMin)}
                    </time>
                    <div
                      className={`cal-slot-event-shell${isResizing ? ' is-resizing' : ''}${
                        isShortResizeShell(Math.max(MOBILE_SLOT_PX / 2, span * MOBILE_SLOT_PX - 8)) ? ' is-short' : ''
                      }`}
                    >
                      {showResizeHandles ? (
                        <span
                          className="cal-resize-handle is-start"
                          role="separator"
                          aria-label="Растянуть начало события"
                          onPointerDown={(ev) => onResizeHandleDown(ev, 'start', eid, dayMins.startMin, dayMins.endMin)}
                        />
                      ) : null}
                      <button
                        type="button"
                        className={`cal-slot-event ${classes} ${colorClass}${isResizing ? ' is-resizing' : ''}`}
                        style={accentStyle}
                        onClick={(ev) => {
                          if (suppressClickIfLongPress(ev)) return
                          if (resizeDraft) return
                          if (e.id) onEventClick(String(e.id))
                        }}
                        onPointerDown={(ev) => {
                          if (resizeDraft) return
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
                          {timeLabel}
                          {client ? ` · ${client}` : ''}
                          {status ? ` · ${status}` : ''}
                        </span>
                      </button>
                      {showResizeHandles ? (
                        <span
                          className="cal-resize-handle is-end"
                          role="separator"
                          aria-label="Растянуть окончание события"
                          onPointerDown={(ev) => onResizeHandleDown(ev, 'end', eid, dayMins.startMin, dayMins.endMin)}
                        />
                      ) : null}
                    </div>
                  </li>,
                )
              }
              return rows
            }

            // Continuation of a multi-slot event: height already claimed by the start row.
            if (covering.length > 0 && !intervalSelecting) {
              return rows
            }

            const openSlot = () => {
              if (intervalSelecting) {
                onIntervalSlotTap?.(slotMin)
                return
              }
              onCreateSlot?.(wallDateAt(selectedDate, ymd, slotMin))
            }

            rows.push(
              <li key={slotMin} className={`cal-slot-row is-free ${inInterval ? 'is-interval' : ''}`}>
                <button
                  type="button"
                  className={`cal-slot-time is-free ${inInterval ? 'is-interval' : ''}`}
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
                  {padTime(slotMin)}
                </button>
                <button
                  type="button"
                  className={`cal-slot-body is-free ${inInterval ? 'is-interval' : ''}`}
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
                  <span className="cal-slot-free-label">
                    {intervalSelecting
                      ? (inInterval ? 'В выбранном интервале' : 'Свободное время')
                      : freeSlotLabel}
                  </span>
                  <span className="chev" aria-hidden>›</span>
                </button>
              </li>,
            )
            return rows
          })}
        </ol>
      )}
      </div>
    </div>
  )
}
