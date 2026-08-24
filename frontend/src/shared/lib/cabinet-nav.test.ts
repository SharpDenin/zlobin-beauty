import { describe, expect, it } from 'vitest'
import { navForCabinet } from './cabinet'

describe('navForCabinet', () => {
  it('does not expose /rep/map to sales reps', () => {
    const nav = navForCabinet('supplier_rep')
    const all = [...nav.primary, ...nav.secondary, ...nav.side]
    expect(all.some((l) => l.to === '/rep/map')).toBe(false)
    expect(all.some((l) => l.label === 'Маршрут')).toBe(false)
  })
})
