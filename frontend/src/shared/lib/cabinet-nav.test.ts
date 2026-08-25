import { describe, expect, it } from 'vitest'
import { navForCabinet } from './cabinet'

describe('navForCabinet', () => {
  it('does not expose /rep/map to sales reps', () => {
    const nav = navForCabinet('supplier_rep')
    const all = [...nav.primary, ...nav.secondary, ...nav.side]
    expect(all.some((l) => l.to === '/rep/map')).toBe(false)
    expect(all.some((l) => l.label === 'Маршрут')).toBe(false)
  })

  it('exposes messenger and marketplaces without replacing notifications', () => {
    const client = navForCabinet('client')
    expect(client.secondary.some((l) => l.to === '/messages' && l.label === 'Сообщения')).toBe(true)
    expect(client.secondary.some((l) => l.to === '/models')).toBe(true)
    const master = navForCabinet('private_master')
    expect(master.secondary.some((l) => l.to === '/messages')).toBe(true)
    expect(master.secondary.some((l) => l.to === '/masterclasses')).toBe(true)
    expect(master.secondary.some((l) => l.to === '/models')).toBe(true)
  })
})
