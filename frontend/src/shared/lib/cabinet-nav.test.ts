import { describe, expect, it } from 'vitest'
import { navForCabinet, resolveCabinetKind } from './cabinet'

describe('navForCabinet', () => {
  it('does not expose /rep/map to sales reps', () => {
    const nav = navForCabinet('supplier_rep')
    const all = [...nav.primary, ...nav.secondary, ...nav.side]
    expect(all.some((l) => l.to === '/rep/map')).toBe(false)
    expect(all.some((l) => l.label === 'Маршрут')).toBe(false)
  })

  it('exposes messenger and marketplaces without replacing notifications', () => {
    const client = navForCabinet('client')
    expect(client.primary.some((l) => l.to === '/more')).toBe(true)
    expect(client.secondary.some((l) => l.to === '/messages' && l.label === 'Сообщения')).toBe(true)
    expect(client.secondary.some((l) => l.to === '/profile')).toBe(true)
    expect(client.secondary.some((l) => l.to === '/models')).toBe(true)
    const master = navForCabinet('private_master')
    expect(master.secondary.some((l) => l.to === '/messages')).toBe(true)
    expect(master.secondary.some((l) => l.to === '/masterclasses')).toBe(true)
    expect(master.secondary.some((l) => l.to === '/models')).toBe(true)
    expect(master.secondary.some((l) => l.to === '/inventory' && l.label === 'Мой склад')).toBe(true)
    expect(master.secondary.some((l) => l.to === '/inventory/receipts' && l.label === 'На приёмке')).toBe(true)
    expect(master.secondary.some((l) => l.to === '/knowledge' && l.label === 'База знаний')).toBe(true)
  })

  it('does not put personal warehouse on supplier nav', () => {
    const nav = navForCabinet('supplier')
    const all = [...nav.primary, ...nav.secondary, ...nav.side]
    expect(all.some((l) => l.to === '/inventory')).toBe(false)
  })

  it('exposes platform admin information architecture', () => {
    const nav = navForCabinet('platform_admin')
    const all = [...nav.primary, ...nav.secondary, ...nav.side]
    expect(nav.primary.some((l) => l.to === '/admin' && l.end)).toBe(true)
    expect(all.some((l) => l.to === '/admin/users')).toBe(true)
    expect(all.some((l) => l.to === '/admin/disputes')).toBe(true)
    expect(all.some((l) => l.to === '/admin/audit')).toBe(true)
    expect(all.some((l) => l.to === '/admin/catalogs')).toBe(true)
    expect(all.some((l) => l.to === '/calendar')).toBe(false)
    expect(resolveCabinetKind({ id: '1', email: 'a@x', phone: null, display_name: 'A', city: '', roles: ['system_admin', 'master'], status: 'active' })).toBe('platform_admin')
  })
})
