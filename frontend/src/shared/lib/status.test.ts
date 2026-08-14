import { describe, expect, it } from 'vitest'
import {
  appointmentStatusLabel,
  productStateLabel,
  statusLabel,
  supplierOrderLabel,
  workTypeLabel,
} from './status'

describe('appointment status labels', () => {
  it('maps pending confirmation', () => {
    expect(appointmentStatusLabel('pending_confirmation')).toBe('Ожидает подтверждения')
  })

  it('maps confirmed', () => {
    expect(appointmentStatusLabel('confirmed')).toBe('Подтверждена')
  })
})

describe('supplier and product labels', () => {
  it('maps supplier order statuses', () => {
    expect(supplierOrderLabel('confirmed')).toBe('Принят')
    expect(supplierOrderLabel('picking')).toBe('Собирается')
    expect(supplierOrderLabel('in_transit')).toBe('В пути')
  })

  it('maps work types', () => {
    expect(workTypeLabel('independent')).toBe('Частный мастер')
  })

  it('maps product states', () => {
    expect(productStateLabel('published')).toBe('Опубликован')
  })

  it('keeps generic statusLabel usable for unique keys', () => {
    expect(statusLabel('pending_confirmation')).toBe('Ожидает подтверждения')
    expect(statusLabel('picking')).toBe('Собирается')
  })
})
