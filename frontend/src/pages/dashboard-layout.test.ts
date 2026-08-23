import { describe, expect, it } from 'vitest'
import { normalizeLayout } from './dashboard-layout'

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
})
