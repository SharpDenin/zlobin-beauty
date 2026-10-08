import { describe, expect, it } from 'vitest'
import { getBreakpointFromWidth } from 'react-grid-layout'
import {
  DASHBOARD_BREAKPOINTS,
  VIEW_ORDER,
  applyGridLayout,
  applyPreset,
  breakpointForWidth,
  cloneLayout,
  defaultLayout,
  groupStack,
  layoutsEqual,
  makeLayouts,
  migrateWidgets,
  normalizeLayout,
  orderForBreakpoint,
  presetSize,
  sortForView,
} from './dashboard-layout'

describe('normalizeLayout', () => {
  it('keeps enabled flag and ignores calendar_colors', () => {
    const layout = normalizeLayout([
      { id: 'alerts', enabled: true, positions: { lg: { x: 0, y: 0, w: 12, h: 5 } } },
      { id: 'messages', enabled: false, positions: { lg: { x: 9, y: 23, w: 3, h: 4 } } },
      { id: 'calendar_colors', colors: { personal: '#aa5533' } },
    ])
    expect(layout.find((w) => w.id === 'alerts')?.enabled).toBe(true)
    expect(layout.find((w) => w.id === 'messages')?.enabled).toBe(false)
    expect(layout.some((w) => (w as { id: string }).id === 'calendar_colors')).toBe(false)
  })

  it('maps legacy important_messages and type/size payloads', () => {
    const layout = normalizeLayout([
      { id: 'important_messages', type: 'important_messages', size: '12x2', x: 0, y: 0, w: 12, h: 2 },
    ])
    const alerts = layout.find((w) => w.id === 'alerts')
    expect(alerts).toBeTruthy()
    expect(alerts?.positions.lg?.w).toBe(12)
    expect(layout.some((w) => w.id === 'calendar')).toBe(true)
  })

  it('migrates removed clients_today / kpi-today-clients out of stored layouts', () => {
    const layout = normalizeLayout([
      { id: 'alerts', enabled: true, positions: { lg: { x: 0, y: 0, w: 12, h: 5 } } },
      { id: 'clients_today', enabled: true, positions: { lg: { x: 6, y: 23, w: 3, h: 4 } } },
      { id: 'kpi-today-clients', enabled: true },
      { id: 'analytics', enabled: true, positions: { lg: { x: 6, y: 27, w: 6, h: 8 } } },
    ])
    expect(layout.some((w) => (w as { id: string }).id === 'clients_today')).toBe(false)
    expect(layout.some((w) => (w as { id: string }).id === 'kpi-today-clients')).toBe(false)
    expect(layout.find((w) => w.id === 'analytics')).toBeTruthy()
  })
})

describe('migrateWidgets', () => {
  it('keeps calendar_colors and known widgets, drops removed ids', () => {
    const next = migrateWidgets([
      { id: 'today', enabled: true },
      { id: 'clients_today', enabled: true },
      { id: 'calendar_colors', colors: {} },
      { id: 'unknown_widget' },
    ])
    const ids = next.map((x) => x.id as string)
    expect(ids).toContain('today')
    expect(ids).toContain('calendar_colors')
    expect(ids).not.toContain('clients_today')
    expect(ids).not.toContain('unknown_widget')
  })
})

describe('sortForView / makeLayouts', () => {
  it('puts analytics last in view hierarchy', () => {
    const layout = defaultLayout()
    const sorted = sortForView(layout)
    expect(sorted[sorted.length - 1]?.id).toBe('analytics')
    expect(VIEW_ORDER[VIEW_ORDER.length - 1]).toBe('analytics')
  })

  it('phone layouts are single-column in hierarchy order', () => {
    const layouts = makeLayouts(defaultLayout())
    const xs = layouts.xs ?? []
    expect(xs.every((item) => item.x === 0 && item.w === 1)).toBe(true)
    expect(xs.map((item) => item.i)).toEqual(
      orderForBreakpoint(defaultLayout(), 'xs').map((w) => w.id),
    )
    expect(xs[xs.length - 1]?.i).toBe('analytics')
  })

  it('breakpointForWidth mirrors react-grid-layout', () => {
    for (const width of [0, 390, 480, 481, 768, 769, 1200, 1201, 1400]) {
      expect(breakpointForWidth(width)).toBe(getBreakpointFromWidth(DASHBOARD_BREAKPOINTS, width))
    }
  })
})

describe('applyPreset / applyGridLayout / cloneLayout', () => {
  it('applies size presets without shrinking below widget mins', () => {
    const next = applyPreset(defaultLayout(), 'calendar', 'compact')
    const cal = next.find((w) => w.id === 'calendar')
    expect(cal?.positions.lg?.w).toBe(presetSize('calendar', 'compact').w)
    expect(cal?.positions.lg?.h).toBeGreaterThanOrEqual(10)
  })

  it('records drag positions for the active breakpoint', () => {
    const next = applyGridLayout(defaultLayout(), 'md', [
      { i: 'alerts', x: 0, y: 2, w: 8, h: 5 },
    ])
    expect(next.find((w) => w.id === 'alerts')?.positions.md).toEqual({ x: 0, y: 2, w: 8, h: 5 })
  })

  it('cloneLayout is deep and layoutsEqual ignores key order', () => {
    const a = defaultLayout()
    const b = cloneLayout(a)
    b[0].positions.lg!.x = 99
    expect(layoutsEqual(a, b)).toBe(false)
    expect(layoutsEqual(a, cloneLayout(a))).toBe(true)
  })

  it('groups consecutive metric tiles on phones', () => {
    const stack = groupStack(orderForBreakpoint(defaultLayout(), 'xs'))
    const tiles = stack.find((item) => item.kind === 'tiles')
    expect(tiles?.kind === 'tiles' && tiles.widgets.map((w) => w.id)).toEqual(['today', 'pending'])
  })
})
