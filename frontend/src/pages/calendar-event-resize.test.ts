import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyResizeDelta,
  attachResizePointerSession,
  isShortResizeShell,
  resizeDraftValid,
} from './calendar-event-resize'

const PX = 44

describe('applyResizeDelta', () => {
  const base = { startMin: 10 * 60, endMin: 11 * 60 }

  it('extends end when dragging the bottom handle down one slot', () => {
    const next = applyResizeDelta('end', base.startMin, base.endMin, PX, PX)
    expect(next).toEqual({ startMin: base.startMin, endMin: 11 * 60 + 30 })
  })

  it('shortens start when dragging the top handle down half a slot (15 min snap)', () => {
    const next = applyResizeDelta('start', base.startMin, base.endMin, PX / 2, PX, 15)
    expect(next.startMin).toBe(10 * 60 + 15)
    expect(next.endMin).toBe(base.endMin)
  })

  it('clamps start so duration stays at least 15 minutes', () => {
    const tight = { startMin: 10 * 60, endMin: 10 * 60 + 30 }
    const next = applyResizeDelta('start', tight.startMin, tight.endMin, PX * 2, PX, 15)
    expect(next.endMin - next.startMin).toBeGreaterThanOrEqual(15)
    expect(next.startMin).toBeLessThanOrEqual(tight.endMin - 15)
  })

  it('clamps end to midnight and start to 0', () => {
    const late = { startMin: 23 * 60, endMin: 23 * 60 + 45 }
    const endNext = applyResizeDelta('end', late.startMin, late.endMin, PX * 4, PX, 15)
    expect(endNext.endMin).toBe(24 * 60)
    const early = { startMin: 15, endMin: 60 }
    const startNext = applyResizeDelta('start', early.startMin, early.endMin, -PX, PX, 15)
    expect(startNext.startMin).toBeGreaterThanOrEqual(0)
  })

  it('leaves interval unchanged when delta is zero', () => {
    expect(applyResizeDelta('end', base.startMin, base.endMin, 0, PX)).toEqual(base)
    expect(applyResizeDelta('start', base.startMin, base.endMin, 0, PX)).toEqual(base)
  })
})

describe('resizeDraftValid', () => {
  it('accepts in-range intervals of at least 15 minutes', () => {
    expect(resizeDraftValid({ id: 'x', edge: 'end', startMin: 600, endMin: 630 })).toBe(true)
  })

  it('rejects intervals shorter than 15 minutes or outside the day', () => {
    expect(resizeDraftValid({ id: 'x', edge: 'end', startMin: 600, endMin: 610 })).toBe(false)
    expect(resizeDraftValid({ id: 'x', edge: 'start', startMin: -15, endMin: 600 })).toBe(false)
    expect(resizeDraftValid({ id: 'x', edge: 'end', startMin: 600, endMin: 24 * 60 + 5 })).toBe(false)
  })
})

describe('isShortResizeShell', () => {
  it('flags shells that cannot fit two in-shell 16px hit strips with a content gap', () => {
    expect(isShortResizeShell(28)).toBe(true)
    expect(isShortResizeShell(44)).toBe(false)
    expect(isShortResizeShell(40, 16)).toBe(true)
    expect(isShortResizeShell(44, 16)).toBe(false)
  })
})

describe('attachResizePointerSession', () => {
  const originY = 100
  const sessionBase = {
    pointerId: 7,
    edge: 'end' as const,
    id: 'ev-1',
    startMin: 600,
    endMin: 660,
    originY,
    slotPx: PX,
  }

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  })

  function start(handlers?: Partial<Parameters<typeof attachResizePointerSession>[1]>) {
    const onMove = vi.fn()
    const onEnd = vi.fn()
    const onCancel = vi.fn()
    const dispose = attachResizePointerSession(sessionBase, {
      onMove: handlers?.onMove ?? onMove,
      onEnd: handlers?.onEnd ?? onEnd,
      onCancel: handlers?.onCancel ?? onCancel,
    })
    return { onMove, onEnd, onCancel, dispose }
  }

  function dispatchPointer(type: string, init: Partial<PointerEvent> & { pointerId?: number; clientY?: number }) {
    const ev = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent
    Object.defineProperty(ev, 'pointerId', { value: init.pointerId ?? 7 })
    Object.defineProperty(ev, 'clientY', { value: init.clientY ?? originY })
    window.dispatchEvent(ev)
    return ev
  }

  it('commits on pointerup and ignores a late lostpointercapture', () => {
    const { onEnd, onCancel } = start()
    dispatchPointer('pointermove', { clientY: originY + PX })
    dispatchPointer('pointerup', { clientY: originY + PX })
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd.mock.calls[0][0]).toEqual({ startMin: 600, endMin: 690 })
    document.dispatchEvent(Object.assign(new Event('lostpointercapture', { bubbles: true }), { pointerId: 7 }))
    expect(onCancel).not.toHaveBeenCalled()
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('cancels on pointercancel without committing', () => {
    const { onEnd, onCancel } = start()
    dispatchPointer('pointermove', { clientY: originY + PX })
    dispatchPointer('pointercancel', { clientY: originY + PX })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('cancels on lostpointercapture before pointerup', () => {
    const { onEnd, onCancel } = start()
    dispatchPointer('pointermove', { clientY: originY + PX })
    const lost = new Event('lostpointercapture', { bubbles: true }) as PointerEvent
    Object.defineProperty(lost, 'pointerId', { value: 7 })
    document.dispatchEvent(lost)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onEnd).not.toHaveBeenCalled()
    dispatchPointer('pointerup', { clientY: originY + PX })
    expect(onEnd).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('cancels on window blur while active', () => {
    const { onEnd, onCancel } = start()
    window.dispatchEvent(new Event('blur'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('cancels when document becomes hidden', () => {
    const { onEnd, onCancel } = start()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('dispose while active cancels once; repeated dispose is safe', () => {
    const { onEnd, onCancel, dispose } = start()
    dispose()
    dispose()
    dispose()
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('dispose after pointerup does not cancel a committed gesture', () => {
    const { onEnd, onCancel, dispose } = start()
    dispatchPointer('pointerup', { clientY: originY + PX })
    dispose()
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('ignores a second pointer id during an active session', () => {
    const { onMove, onEnd } = start()
    dispatchPointer('pointermove', { pointerId: 99, clientY: originY + PX })
    expect(onMove).not.toHaveBeenCalled()
    dispatchPointer('pointerup', { pointerId: 99, clientY: originY + PX })
    expect(onEnd).not.toHaveBeenCalled()
  })
})
