import { describe, expect, it } from 'vitest'
import { applyNavOrder, type NavLink } from '@/shared/lib/cabinet'

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
