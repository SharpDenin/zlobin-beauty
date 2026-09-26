import { describe, expect, it } from 'vitest'
import {
  acceptanceStateLabel,
  canCommitReceipt,
  discrepancyQty,
  formatQty,
  lineNeedsCheck,
  movementContext,
  movementDelta,
  movementTitle,
  receiptTotals,
  receivableQty,
  remainingToAccept,
} from './inventory-helpers'

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

  it('computes receivable after a recorded delivery leftover of 0', () => {
    expect(receivableQty(10, 0, 6, 0, 0)).toBe(4)
    expect(receivableQty(100, 90, 80, 5, 5)).toBe(10)
  })

  it('shows undelivered discrepancy', () => {
    expect(discrepancyQty(100, 90)).toBe(10)
    expect(discrepancyQty(10, 0)).toBe(0)
  })

  it('describes movement context', () => {
    expect(movementContext({
      id: '1', kind: 'receipt', qty: 80, reason: 'приёмка заказа', product_id: 'p',
      ref_type: 'supplier_order', ref_id: '12345678-aaaa-bbbb-cccc-dddddddddddd', created_at: '',
    })).toContain('заказ #12345678')
    expect(movementContext({
      id: '1', kind: 'receipt', qty: 80, reason: 'приёмка заказа', product_id: 'p',
      ref_type: 'supplier_order', ref_id: '12345678-aaaa-bbbb-cccc-dddddddddddd',
      supplier_name: 'Loreal', created_at: '',
    })).toContain('Поставщик: Loreal')
    expect(movementContext({
      id: '2', kind: 'consumption', qty: -30, reason: 'расход', product_id: 'p',
      ref_type: 'appointment', ref_id: '45645678-aaaa-bbbb-cccc-dddddddddddd', created_at: '',
    })).toContain('визит #45645678')
  })

  it('requires a check only for received remaining lines', () => {
    expect(lineNeedsCheck(10, 6, 0, 0)).toBe(true)
    expect(lineNeedsCheck(10, 0, 0, 0)).toBe(false)
    expect(lineNeedsCheck(0, 0, 0, 0)).toBe(false)
  })

  it('disables commit until required items are checked', () => {
    expect(canCommitReceipt([
      { remaining: 10, accepted: 8, damaged: 1, rejected: 1, checked: false },
    ])).toBe(false)
    expect(canCommitReceipt([
      { remaining: 10, accepted: 8, damaged: 1, rejected: 1, checked: true },
    ])).toBe(true)
    expect(canCommitReceipt([
      { remaining: 4, accepted: 0, damaged: 0, rejected: 0, checked: false },
    ])).toBe(false)
  })

  it('totals stock vs damaged/rejected', () => {
    expect(receiptTotals([
      { accepted: 80, damaged: 10, rejected: 10 },
    ])).toEqual({ accepted: 80, damaged: 10, rejected: 10, stockIn: 80, notStock: 20 })
  })

  it('labels acceptance state', () => {
    expect(acceptanceStateLabel('pending')).toBe('Ожидает приёмки')
    expect(acceptanceStateLabel('in_progress')).toBe('На приёмке')
    expect(acceptanceStateLabel('completed')).toBe('Принято')
  })
})
