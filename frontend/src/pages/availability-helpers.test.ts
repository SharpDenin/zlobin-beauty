import { describe, expect, it } from 'vitest'
import {
  alternativeMessage,
  availabilityStatusLabel,
  availabilityStatusMark,
  cosmeticsProductPath,
  itemAvailable,
  itemIncoming,
  itemShortage,
  overallAvailabilityMessage,
  showOrderCta,
  type AvailabilityItem,
} from './availability-helpers'

const line = (over: Partial<AvailabilityItem>): AvailabilityItem => ({
  product_id: 'p',
  required_qty: 30,
  status: 'available',
  ...over,
})

describe('availability-helpers', () => {
  it('reads qty aliases without recomputing stock', () => {
    expect(itemAvailable(line({ available: 20, available_qty: 99 }))).toBe(20)
    expect(itemAvailable(line({ available_qty: 12 }))).toBe(12)
    expect(itemIncoming(line({ incoming: 8 }))).toBe(8)
    expect(itemShortage(line({ shortage_qty: 10 }))).toBe(10)
  })

  it('labels statuses for the panel', () => {
    expect(availabilityStatusLabel('available')).toBe('Хватает')
    expect(availabilityStatusLabel('incoming')).toBe('Ожидается поставка')
    expect(availabilityStatusLabel('orderable')).toBe('Можно заказать')
    expect(availabilityStatusLabel('shortage')).toBe('Не хватает')
    expect(availabilityStatusLabel('unavailable')).toBe('Невозможно получить')
    expect(availabilityStatusMark('available')).toBe('✓')
    expect(availabilityStatusMark('incoming')).toBe('⚠')
    expect(availabilityStatusMark('orderable')).toBe('→')
  })

  it('summarizes overall status', () => {
    expect(overallAvailabilityMessage('available', true)).toContain('хватает')
    expect(overallAvailabilityMessage('incoming', false)).toContain('поставк')
    expect(overallAvailabilityMessage('orderable', false)).toContain('заказать')
  })

  it('shows order CTA only for catalog-orderable gaps', () => {
    expect(showOrderCta(line({ status: 'orderable', orderable: true }))).toBe(true)
    expect(showOrderCta(line({ status: 'available', orderable: true }))).toBe(false)
    expect(showOrderCta(line({ status: 'unavailable', orderable: false }))).toBe(false)
  })

  it('does not invent an alternative formula', () => {
    expect(alternativeMessage({ available: false })).toBe('Нет сохранённой альтернативы')
    expect(alternativeMessage({ available: false, reason: 'Нет сохранённой альтернативы' })).toContain('Нет сохранённой')
    expect(cosmeticsProductPath('abc')).toBe('/cosmetics/products/abc')
  })
})
