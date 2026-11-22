import { describe, expect, it } from 'vitest'
import {
  appointmentOnYmd,
  dayKey,
  formatOwnerDate,
  homeTiles,
  isDemoAccount,
  isOwnerStartKind,
  ownerManagementTiles,
  pendingConfirmLabel,
  sameCalendarDay,
  shortPersonName,
  weekDays,
  weekYmds,
} from '@/features/owner-home/owner-home-helpers'

describe('owner-home-helpers', () => {
  it('recognizes salon operations start kinds', () => {
    expect(isOwnerStartKind('salon_owner')).toBe(true)
    expect(isOwnerStartKind('chain_owner')).toBe(true)
    expect(isOwnerStartKind('salon_admin')).toBe(true)
    expect(isOwnerStartKind('private_master')).toBe(false)
  })

  it('builds a Monday-first week', () => {
    const days = weekDays(new Date('2026-10-02T12:00:00'))
    expect(days).toHaveLength(7)
    expect(days[0].getDay()).toBe(1)
    expect(dayKey(days[4])).toBe('2026-10-02')
  })

  it('shortens a person name without leaking IDs', () => {
    expect(shortPersonName('Мария Козлова')).toBe('Мария К.')
    expect(shortPersonName('Елена')).toBe('Елена')
    expect(shortPersonName('')).toBe('')
  })

  it('matches appointments to a calendar day', () => {
    const day = new Date(2026, 9, 2, 12)
    expect(sameCalendarDay(new Date(2026, 9, 2, 10).toISOString(), day)).toBe(true)
    expect(sameCalendarDay(new Date(2026, 9, 3, 10).toISOString(), day)).toBe(false)
  })

  it('matches appointments by salon YMD when browser zone differs', () => {
    // 02:00 Krasnoyarsk on Aug 20 = previous evening UTC
    const iso = '2026-08-19T19:00:00.000Z'
    expect(appointmentOnYmd(iso, '2026-08-20', 'Asia/Krasnoyarsk')).toBe(true)
    expect(sameCalendarDay(iso, new Date('2026-08-20T12:00:00Z'), 'Asia/Krasnoyarsk')).toBe(true)
    const week = weekYmds('Asia/Krasnoyarsk', new Date('2026-08-20T05:00:00.000Z'))
    expect(week).toHaveLength(7)
    expect(week[0]).toBe('2026-08-17') // Monday
    expect(week).toContain('2026-08-20')
  })

  it('picks compact management tiles from real capabilities', () => {
    const tiles = ownerManagementTiles((f) => ['staff', 'reports', 'cosmetics', 'salon_settings'].includes(f))
    expect(tiles.map((t) => t.label)).toEqual(['Команда', 'Финансы', 'Склад', 'Настройки салона'])
  })

  it('labels pending confirmations in Russian', () => {
    expect(pendingConfirmLabel(1)).toBe('1 запись ждёт подтверждения')
    expect(pendingConfirmLabel(2)).toBe('2 записи ждут подтверждения')
    expect(pendingConfirmLabel(5)).toBe('5 записей ждут подтверждения')
  })

  it('marks only demo.local accounts as demo', () => {
    expect(isDemoAccount('owner1@demo.local')).toBe(true)
    expect(isDemoAccount('anna@salon.ru')).toBe(false)
  })

  it('formats today as a human date line', () => {
    expect(formatOwnerDate(new Date())).toMatch(/^Сегодня · /)
  })

  it('labels client search tile as Поиск мастера', () => {
    const tiles = homeTiles('client', () => false)
    expect(tiles.find((t) => t.to === '/search')?.label).toBe('Поиск мастера')
  })
})
