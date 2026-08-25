import { describe, expect, it } from 'vitest'
import { formatRequirementLine, overallRepeatMessage, requirementStatusLabel, soonestIncomingDate, toDatetimeLocalValue, type RepeatPreview } from './repeat-helpers'

const base: RepeatPreview = {
  can_repeat: true,
  availability_status: 'available',
  source_appointment_id: 'a',
  service_id: 's',
  service: 'Окрашивание',
  date: '2026-08-12T10:00:00Z',
  requirements: [],
}

describe('repeat-helpers', () => {
  it('labels statuses', () => {
    expect(requirementStatusLabel('available')).toBe('В наличии')
    expect(requirementStatusLabel('shortage')).toBe('Не хватает')
    expect(requirementStatusLabel('incoming')).toBe('Ожидается поставка')
  })

  it('summarizes available vs shortage vs incoming', () => {
    expect(overallRepeatMessage(base)).toBe('Материалы в наличии')
    expect(overallRepeatMessage({ ...base, can_repeat: false, availability_status: 'shortage' })).toContain('Не хватает')
    expect(overallRepeatMessage({ ...base, can_repeat: false, availability_status: 'incoming' })).toContain('поставк')
  })

  it('keeps material status when formula is hidden', () => {
    expect(overallRepeatMessage({
      ...base,
      formula_hidden: true,
      hidden_reason: 'Формула скрыта по настройкам доступа',
    })).toBe('Материалы в наличии')
  })

  it('formats datetime-local values', () => {
    expect(toDatetimeLocalValue('2026-08-20T10:30:00+07:00')).toMatch(/T\d{2}:\d{2}$/)
    expect(toDatetimeLocalValue('not-a-date')).toBe('')
  })

  it('formats requirement lines', () => {
    expect(formatRequirementLine({
      product_id: 'p', product_name: 'Majirel 7.1', brand: '', unit: 'мл',
      required_qty: 30, available_qty: 50, incoming_qty: 0, shortage_qty: 0, status: 'available',
    })).toContain('30')
    expect(formatRequirementLine({
      product_id: 'p', product_name: 'Majirel 8.0', unit: 'мл',
      required_qty: 30, available_qty: 10, incoming_qty: 0, shortage_qty: 20, status: 'shortage',
    })).toContain('нужно 30')
  })

  it('picks soonest incoming date', () => {
    expect(soonestIncomingDate([
      { product_id: 'a', required_qty: 1, available_qty: 0, incoming_qty: 1, shortage_qty: 0, status: 'incoming', expected_at: '2026-08-28' },
      { product_id: 'b', required_qty: 1, available_qty: 0, incoming_qty: 1, shortage_qty: 0, status: 'incoming', expected_at: '2026-08-20' },
    ])).toBe('2026-08-20')
  })
})
