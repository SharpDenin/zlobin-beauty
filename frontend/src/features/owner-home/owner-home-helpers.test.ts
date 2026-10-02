import { describe, expect, it } from 'vitest'
import {
  dayKey,
  formatOwnerDate,
  isDemoAccount,
  isOwnerStartKind,
  ownerManagementTiles,
  pendingConfirmLabel,
  sameCalendarDay,
  shortPersonName,
  weekDays,
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

  it('picks compact management tiles from real capabilities', () => {
    const tiles = ownerManagementTiles((f) => ['staff', 'reports', 'cosmetics', 'salon_settings'].includes(f))
    expect(tiles.map((t) => t.label)).toEqual(['Команда', 'Финансы', 'Запасы', 'Настройки'])
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
})
