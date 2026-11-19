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
 * True when an event shell is too short for two full in-shell hit strips
 * (default 16px each) plus a small content gap.
 */
export function isShortResizeShell(heightPx: number, handleHPx = 16) {
  return heightPx < handleHPx * 2 + 12
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
