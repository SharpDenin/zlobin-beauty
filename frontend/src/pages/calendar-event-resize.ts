import { snapMinutes } from '@/pages/calendar-helpers'

export type ResizeEdge = 'start' | 'end'

export type ResizeDraft = {
  id: string
  edge: ResizeEdge
  startMin: number
  endMin: number
}

const MIN_DURATION = 15

/** Apply pointer delta (px) to an event interval on a time grid. */
export function applyResizeDelta(
  edge: ResizeEdge,
  startMin: number,
  endMin: number,
  deltaPx: number,
  pxPerSlot: number,
  snap = 15,
): { startMin: number; endMin: number } {
  const deltaMin = (deltaPx / pxPerSlot) * 30
  if (edge === 'start') {
    let nextStart = snapMinutes(startMin + deltaMin, snap)
    nextStart = Math.min(nextStart, endMin - MIN_DURATION)
    nextStart = Math.max(0, nextStart)
    return { startMin: nextStart, endMin }
  }
  let nextEnd = snapMinutes(endMin + deltaMin, snap)
  nextEnd = Math.max(nextEnd, startMin + MIN_DURATION)
  nextEnd = Math.min(24 * 60, nextEnd)
  return { startMin, endMin: nextEnd }
}

export function resizeDraftValid(d: ResizeDraft) {
  return d.endMin - d.startMin >= MIN_DURATION && d.startMin >= 0 && d.endMin <= 24 * 60
}

/**
 * True when a shell cannot fit two external-handle gutters (default 14px)
 * plus a readable card body.
 */
export function isShortResizeShell(heightPx: number, handleOutPx = 14) {
  return heightPx < handleOutPx * 2 + 20
}

type LockedScrollRoot = {
  el: HTMLElement
  overflow: string
  overflowX: string
  overflowY: string
  touchAction: string
  scrollTop: number
  scrollLeft: number
}

/**
 * Temporarily freeze page + calendar scrollports for an active drag/resize gesture.
 * Idempotent release; restores overflow/touch-action and prior scroll offsets.
 */
export function lockCalendarGesture(scrollRoots: Array<HTMLElement | null | undefined> = []): () => void {
  const body = document.body
  const prevTouch = body.style.touchAction
  const prevOverflow = body.style.overflow
  body.classList.add('is-cal-resizing')
  body.style.touchAction = 'none'
  body.style.overflow = 'hidden'

  const locked: LockedScrollRoot[] = []
  for (const el of scrollRoots) {
    if (!el || locked.some((item) => item.el === el)) continue
    locked.push({
      el,
      overflow: el.style.overflow,
      overflowX: el.style.overflowX,
      overflowY: el.style.overflowY,
      touchAction: el.style.touchAction,
      scrollTop: el.scrollTop,
      scrollLeft: el.scrollLeft,
    })
    el.style.overflow = 'hidden'
    el.style.overflowX = 'hidden'
    el.style.overflowY = 'hidden'
    el.style.touchAction = 'none'
    el.classList.add('is-cal-scroll-locked')
  }

  const freezeScroll = () => {
    for (const item of locked) {
      if (item.el.scrollTop !== item.scrollTop) item.el.scrollTop = item.scrollTop
      if (item.el.scrollLeft !== item.scrollLeft) item.el.scrollLeft = item.scrollLeft
    }
  }
  const onTouchMove = (e: TouchEvent) => {
    freezeScroll()
    if (e.cancelable) e.preventDefault()
  }
  const onWheel = (e: WheelEvent) => {
    freezeScroll()
    e.preventDefault()
  }
  document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true })
  document.addEventListener('wheel', onWheel, { passive: false, capture: true })
  const scrollListenerOpts = { passive: true, capture: true } as const
  for (const item of locked) {
    item.el.addEventListener('scroll', freezeScroll, scrollListenerOpts)
  }

  let released = false
  return () => {
    if (released) return
    released = true
    document.removeEventListener('touchmove', onTouchMove, true)
    document.removeEventListener('wheel', onWheel, true)
    for (const item of locked) {
      item.el.removeEventListener('scroll', freezeScroll, true)
      item.el.style.overflow = item.overflow
      item.el.style.overflowX = item.overflowX
      item.el.style.overflowY = item.overflowY
      item.el.style.touchAction = item.touchAction
      item.el.classList.remove('is-cal-scroll-locked')
      item.el.scrollTop = item.scrollTop
      item.el.scrollLeft = item.scrollLeft
    }
    body.classList.remove('is-cal-resizing')
    body.style.touchAction = prevTouch
    body.style.overflow = prevOverflow
  }
}

/** Collect FullCalendar / custom calendar scrollports under a root. */
export function findCalendarScrollRoots(root: ParentNode | null | undefined): HTMLElement[] {
  if (!root || !('querySelectorAll' in root)) return []
  return [
    ...root.querySelectorAll<HTMLElement>(
      '.fc-scroller, .fc-scroller-liquid, .fc-scroller-liquid-absolute, .cal-masters-scroll, .cal-mobile-body, .cal-slot-grid',
    ),
  ]
}

type ResizePointerSession = {
  pointerId: number
  edge: ResizeEdge
  id: string
  startMin: number
  endMin: number
  originY: number
  slotPx: number
  /** Element that called setPointerCapture (optional; enables lostpointercapture). */
  captureTarget?: EventTarget | null
}

type ResizePointerHandlers = {
  onMove: (next: { startMin: number; endMin: number }) => void
  onEnd: (next: { startMin: number; endMin: number }) => void
  onCancel: () => void
}

/**
 * Document-level pointer tracking for one-finger resize.
 * More reliable than element capture alone on mobile (nested scroll + touch-action).
 *
 * Settle rules:
 * - `pointerup` → onEnd (commit)
 * - `pointercancel` / blur / visibility hidden / lostpointercapture (while active) → onCancel
 * - dispose() while unsettled → onCancel
 * - late lostpointercapture after settle is ignored
 * - onEnd / onCancel fire at most once
 */
export function attachResizePointerSession(
  session: ResizePointerSession,
  handlers: ResizePointerHandlers,
): () => void {
  let settled: false | 'end' | 'cancel' = false

  const compute = (clientY: number) =>
    applyResizeDelta(session.edge, session.startMin, session.endMin, clientY - session.originY, session.slotPx)

  const detach = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancelEv)
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('visibilitychange', onVisibility)
    document.removeEventListener('lostpointercapture', onLostCapture, true)
    session.captureTarget?.removeEventListener?.('lostpointercapture', onLostCapture as EventListener)
  }

  const settleEnd = (clientY: number) => {
    if (settled) return
    settled = 'end'
    detach()
    handlers.onEnd(compute(clientY))
  }

  const settleCancel = () => {
    if (settled) return
    settled = 'cancel'
    detach()
    handlers.onCancel()
  }

  const onMove = (e: PointerEvent) => {
    if (settled || e.pointerId !== session.pointerId) return
    e.preventDefault()
    handlers.onMove(compute(e.clientY))
  }

  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== session.pointerId) return
    e.preventDefault()
    settleEnd(e.clientY)
  }

  const onCancelEv = (e: PointerEvent) => {
    if (e.pointerId !== session.pointerId) return
    settleCancel()
  }

  const onLostCapture = (e: Event) => {
    const pe = e as PointerEvent
    if (typeof pe.pointerId === 'number' && pe.pointerId !== session.pointerId) return
    // Late lostpointercapture after a normal pointerup must not cancel a committed resize.
    settleCancel()
  }

  const onBlur = () => {
    settleCancel()
  }

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') settleCancel()
  }

  window.addEventListener('pointermove', onMove, { passive: false })
  window.addEventListener('pointerup', onUp, { passive: false })
  window.addEventListener('pointercancel', onCancelEv)
  window.addEventListener('blur', onBlur)
  document.addEventListener('visibilitychange', onVisibility)
  // Capture phase on document catches retargeted lostpointercapture from the handle.
  document.addEventListener('lostpointercapture', onLostCapture, true)
  if (session.captureTarget && 'addEventListener' in session.captureTarget) {
    session.captureTarget.addEventListener('lostpointercapture', onLostCapture as EventListener)
  }

  /** Idempotent dispose: cancels only if the gesture never settled. */
  return () => {
    if (!settled) settleCancel()
    else detach()
  }
}
