import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { EventInput } from '@fullcalendar/core'
import { initials } from '@/shared/lib/initials'
import {
  appointmentToneClass,
  buildHalfHourSlots,
  calendarColorClass,
  canDragAppointment,
  displayRangeToSlotTimes,
  eventDurationMinutes,
  eventOverlapsDay,
  formatCalendarNowLabel,
  LONG_PRESS_MS,
  longPressMoved,
  minutesFromMidnight,
  minutesToHHMM,
  zonedYmd,
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

export type MasterCol = { userId: string; name: string; photoUrl?: string | null }

type Props = {
  masters: MasterCol[]
  events: EventInput[]
  timezone: string
  selectedDate: Date
  displayRange: { from: string; to: string }
  loading?: boolean
  onEventClick: (id: string) => void
  onEventLongPress?: (id: string) => void
  onCreateSlot?: (start: Date, masterUserId: string) => void
  onEventResize?: (id: string, startMin: number, endMin: number) => void | Promise<void>
  canResizeEvent?: (event: EventInput) => boolean
}

const SLOT_PX = 44

function wallDateAt(anchor: Date, ymd: string, startMin: number) {
  const [y, mo, d] = ymd.split('-').map(Number)
  const local = new Date(anchor)
  local.setFullYear(y, mo - 1, d)
  local.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0)
  return local
}

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

function eventRawMinutes(e: EventInput, timezone: string) {
  const startIso = String(e.start)
  const endIso = e.end ? String(e.end) : undefined
  const startMin = minutesFromMidnight(new Date(startIso), timezone)
  const endMin = startMin + eventDurationMinutes(startIso, endIso, timezone)
  return { startMin, endMin }
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

export function CalendarMastersDay({
  masters,
  events,
  timezone,
  selectedDate,
  displayRange,
  loading,
  onEventClick,
  onEventLongPress,
  onCreateSlot,
  onEventResize,
  canResizeEvent,
}: Props) {
  const longPressTimer = useRef<number | null>(null)
  const longPressFired = useRef(false)
  const resizeJustFinished = useRef(false)
  const pressOrigin = useRef<{ x: number; y: number } | null>(null)
  const resizeBase = useRef<{ id: string; edge: ResizeEdge; startMin: number; endMin: number } | null>(null)
  const resizeCleanup = useRef<(() => void) | null>(null)
  const gestureUnlock = useRef<(() => void) | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [resizeDraft, setResizeDraft] = useState<ResizeDraft | null>(null)
  const [nowLabel, setNowLabel] = useState(() => formatCalendarNowLabel(new Date(), timezone))

  const ymd = zonedYmd(selectedDate, timezone)
  const todayYmd = zonedYmd(new Date(), timezone)
  const isToday = ymd === todayYmd
  const { fromMin, toMin } = useMemo(() => displayRangeToSlotTimes(displayRange), [displayRange])
  const slots = useMemo(() => buildHalfHourSlots(fromMin, toMin), [fromMin, toMin])
  const boardHeight = slots.length * SLOT_PX
  const nowMin = isToday ? minutesFromMidnight(new Date(), timezone) : -1

  const dayEvents = useMemo(
    () =>
      events
        .filter((e) => e.display !== 'background' && e.extendedProps?.kind !== 'work-mode')
        .filter((e) => e.start && eventOverlapsDay(String(e.start), e.end ? String(e.end) : undefined, ymd, timezone)),
    [events, ymd, timezone],
  )

  const eventsByMaster = useMemo(() => {
    const map = new Map<string, EventInput[]>()
    for (const m of masters) map.set(m.userId, [])
    for (const e of dayEvents) {
      const mid = eventMasterUserId(e)
      if (!mid || !map.has(mid)) continue
      map.get(mid)!.push(e)
    }
    for (const list of map.values()) {
      list.sort((a, b) => String(a.start).localeCompare(String(b.start)))
    }
    return map
  }, [dayEvents, masters])

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
      /* window listeners remain the source of truth */
    }
    resizeCleanup.current = attachResizePointerSession(
      {
        pointerId: e.pointerId,
        edge,
        id: eid,
        startMin,
        endMin,
        originY: e.clientY,
        slotPx: SLOT_PX,
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

  function layoutEvent(e: EventInput, draft?: { startMin: number; endMin: number }) {
    const startIso = String(e.start)
    const endIso = e.end ? String(e.end) : undefined
    let startMin = minutesFromMidnight(new Date(startIso), timezone)
    let endMin = startMin + eventDurationMinutes(startIso, endIso, timezone)
    if (draft) {
      startMin = draft.startMin
      endMin = draft.endMin
    } else {
      if (zonedYmd(new Date(startIso), timezone) !== ymd) {
        startMin = fromMin
      }
      if (endIso && zonedYmd(new Date(endIso), timezone) !== ymd) {
        endMin = toMin
      }
    }
    const topMin = Math.max(startMin, fromMin)
    const bottomMin = Math.min(endMin, toMin)
    if (bottomMin <= topMin) return null
    const top = ((topMin - fromMin) / 30) * SLOT_PX
    const height = Math.max(SLOT_PX / 2, ((bottomMin - topMin) / 30) * SLOT_PX - 2)
    return { top, height, startMin: topMin, endMin: bottomMin }
  }

  if (loading) {
    return (
      <div className="cal-masters-day" data-testid="calendar-masters-day" aria-busy="true">
        <div className="skeleton skeleton-card" style={{ minHeight: 240 }} />
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className={`cal-masters-day${resizeDraft ? ' is-cal-resizing' : ''}`}
      data-testid="calendar-masters-day"
      style={{ ['--cal-masters-slot-h' as string]: `${SLOT_PX}px`, ['--cal-masters-board-h' as string]: `${boardHeight}px` } as CSSProperties}
    >
      <div className="cal-masters-scroll">
        <div
          className="cal-masters-board"
          role="grid"
          aria-label={`Расписание мастеров на ${ymd}`}
          style={{ ['--cal-masters-cols' as string]: String(masters.length) } as CSSProperties}
        >
          <div className="cal-masters-head" role="row">
            <div className="cal-masters-gutter cal-masters-head-gutter" role="columnheader" aria-hidden />
            {masters.map((m) => (
              <div key={m.userId} className="cal-masters-col-head" role="columnheader">
                {m.photoUrl ? (
                  <img className="cal-masters-avatar" src={m.photoUrl} alt="" loading="lazy" decoding="async" />
                ) : (
                  <span className="cal-masters-avatar cal-masters-avatar--initials" aria-hidden>
                    {initials(m.name)}
                  </span>
                )}
                <span className="cal-masters-name">{m.name}</span>
              </div>
            ))}
          </div>

          <div className="cal-masters-body">
            <div className="cal-masters-gutter" aria-hidden>
              {slots.map((min) => (
                <time key={min} className="cal-masters-time" style={{ height: SLOT_PX }} dateTime={minutesToHHMM(min)}>
                  {minutesToHHMM(min)}
                </time>
              ))}
            </div>

            <div className="cal-masters-cols">
              {masters.map((m) => (
                <div key={m.userId} className="cal-masters-col" role="gridcell" style={{ height: boardHeight }}>
                  <div className="cal-masters-grid-lines" aria-hidden>
                    {slots.map((slotMin) => (
                      <button
                        key={slotMin}
                        type="button"
                        className="cal-masters-slot-hit"
                        style={{ height: SLOT_PX }}
                        tabIndex={onCreateSlot ? 0 : -1}
                        aria-label={`Свободный слот ${minutesToHHMM(slotMin)}`}
                        onClick={() => {
                          if (!onCreateSlot) return
                          onCreateSlot(wallDateAt(selectedDate, ymd, slotMin), m.userId)
                        }}
                      />
                    ))}
                  </div>

                  {isToday && nowMin >= fromMin && nowMin < toMin ? (
                    <div
                      className="cal-masters-now"
                      style={{ top: ((nowMin - fromMin) / 30) * SLOT_PX }}
                      aria-hidden
                    >
                      <span className="cal-masters-now-line" />
                      <span className="cal-masters-now-label">{nowLabel}</span>
                    </div>
                  ) : null}

                  {(eventsByMaster.get(m.userId) ?? []).map((e) => {
                    const eid = String(e.id)
                    const isResizing = resizeDraft?.id === eid
                    const geom = layoutEvent(
                      e,
                      isResizing ? { startMin: resizeDraft!.startMin, endMin: resizeDraft!.endMin } : undefined,
                    )
                    if (!geom || !e.id) return null
                    const showResizeHandles = canResizeEvent?.(e) ?? defaultCanResize(e)
                    const colorClass = calendarColorClass(
                      String((e.extendedProps as { color?: string } | undefined)?.color ?? ''),
                      String((e.extendedProps as { category?: string } | undefined)?.category ?? 'task'),
                    )
                    const classes = eventClasses(e)
                    const resizeBaseMins = eventRawMinutes(e, timezone)
                    const timeLabel = isResizing
                      ? `${minutesToHHMM(resizeDraft!.startMin)}–${minutesToHHMM(resizeDraft!.endMin)}`
                      : `${minutesToHHMM(geom.startMin)}`
                    const hexStyle =
                      colorClass === 'cal-color-hex'
                        ? ({
                            ['--cal-event-accent' as string]: String(
                              (e.extendedProps as { colorCss?: string; color?: string } | undefined)?.colorCss
                                ?? (e.extendedProps as { color?: string } | undefined)?.color,
                            ),
                          } as CSSProperties)
                        : undefined
                    return (
                      <div
                        key={String(e.id)}
                        className={`cal-masters-event-shell${isResizing ? ' is-resizing' : ''}${
                          isShortResizeShell(geom.height) ? ' is-short' : ''
                        }`}
                        style={{
                          top: geom.top,
                          height: geom.height,
                          ...hexStyle,
                        }}
                      >
                        {showResizeHandles ? (
                          <span
                            className="cal-resize-handle is-start"
                            role="separator"
                            aria-label="Растянуть начало события"
                            onPointerDown={(ev) =>
                              onResizeHandleDown(ev, 'start', eid, resizeBaseMins.startMin, resizeBaseMins.endMin)
                            }
                          />
                        ) : null}
                        <button
                          type="button"
                          className={`cal-masters-event ${classes} ${colorClass}${isResizing ? ' is-resizing' : ''}`}
                          onClick={(ev) => {
                            if (suppressClickIfLongPress(ev)) return
                            if (resizeDraft) return
                            onEventClick(String(e.id))
                          }}
                          onPointerDown={(ev) => {
                            if (resizeDraft) return
                            if (ev.pointerType === 'mouse' && ev.button !== 0) return
                            pressOrigin.current = { x: ev.clientX, y: ev.clientY }
                            if (onEventLongPress) {
                              armLongPress(() => onEventLongPress(String(e.id)))
                            }
                          }}
                          onPointerMove={onPressMove}
                          onPointerUp={clearLongPress}
                          onPointerCancel={clearLongPress}
                          onPointerLeave={clearLongPress}
                        >
                          <strong>{e.title}</strong>
                          <span className="muted">
                            {timeLabel}
                            {e.extendedProps?.clientName ? ` · ${String(e.extendedProps.clientName)}` : ''}
                          </span>
                        </button>
                        {showResizeHandles ? (
                          <span
                            className="cal-resize-handle is-end"
                            role="separator"
                            aria-label="Растянуть окончание события"
                            onPointerDown={(ev) =>
                              onResizeHandleDown(ev, 'end', eid, resizeBaseMins.startMin, resizeBaseMins.endMin)
                            }
                          />
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}