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
