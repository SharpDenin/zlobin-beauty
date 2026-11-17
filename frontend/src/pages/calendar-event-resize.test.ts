import { describe, expect, it } from 'vitest'
import { applyResizeDelta, resizeDraftValid } from './calendar-event-resize'

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