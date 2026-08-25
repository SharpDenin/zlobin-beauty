import { describe, expect, it } from 'vitest'
import { formatQty, movementContext, movementDelta, movementTitle, remainingToAccept } from './inventory-helpers'

describe('inventory-helpers', () => {
  it('formats qty with unit', () => {
    expect(formatQty(80, 'ml')).toBe('80 мл')
    expect(formatQty(1.5, 'pcs')).toBe('1.5 шт')
  })

  it('labels movement kinds', () => {
    expect(movementTitle('receipt')).toBe('Приёмка')
    expect(movementTitle('consumption')).toBe('Расход')
    expect(movementDelta('receipt', 80)).toBe('+80')
    expect(movementDelta('consumption', -30)).toBe('−30')
    expect(movementDelta('damage', 10)).toContain('не на складе')
  })

  it('computes remaining to accept', () => {
    expect(remainingToAccept(100, 80, 10, 10)).toBe(0)
    expect(remainingToAccept(10, 6, 0, 0)).toBe(4)
  })

  it('describes movement context', () => {
    expect(movementContext({
      id: '1', kind: 'receipt', qty: 80, reason: 'приёмка заказа', product_id: 'p',
      ref_type: 'supplier_order', ref_id: '12345678-aaaa-bbbb-cccc-dddddddddddd', created_at: '',
    })).toContain('заказ #12345678')
    expect(movementContext({
      id: '2', kind: 'consumption', qty: -30, reason: 'расход', product_id: 'p',
      ref_type: 'appointment', ref_id: '45645678-aaaa-bbbb-cccc-dddddddddddd', created_at: '',
    })).toContain('визит #45645678')
  })
})
