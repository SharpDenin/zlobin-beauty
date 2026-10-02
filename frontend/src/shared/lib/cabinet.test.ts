import { describe, expect, it } from 'vitest'
import { applyNavOrder, moveNavPath, navForCabinet, type NavLink } from '@/shared/lib/cabinet'

describe('applyNavOrder', () => {
  const links: NavLink[] = [
    { to: '/', label: 'Главная', end: true },
    { to: '/calendar', label: 'Календарь' },
    { to: '/appointments', label: 'Записи' },
    { to: '/more', label: 'Ещё' },
  ]

  it('keeps default order when preference is empty', () => {
    expect(applyNavOrder(links, []).map((l) => l.to)).toEqual(['/', '/calendar', '/appointments', '/more'])
  })

  it('reorders primary tabs and pins Ещё last', () => {
    const next = applyNavOrder(links, ['/appointments', '/', '/calendar'])
    expect(next.map((l) => l.to)).toEqual(['/appointments', '/', '/calendar', '/more'])
  })
})

describe('moveNavPath', () => {
  it('moves an item for drag reorder', () => {
    expect(moveNavPath(['/', '/calendar', '/appointments'], 2, 0)).toEqual(['/appointments', '/', '/calendar'])
  })
})

describe('navForCabinet', () => {
  it('uses product labels for salon owner tabs', () => {
    const nav = navForCabinet('salon_owner')
    expect(nav.primary.map((l) => l.label)).toEqual(['Обзор', 'Расписание', 'Записи', 'Ещё'])
  })
})
