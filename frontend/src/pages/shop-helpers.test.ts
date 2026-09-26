import { describe, expect, it } from 'vitest'
import {
  cartLineInsufficient,
  nextCartQty,
  shopHasActiveFilters,
  shopLineTotal,
  shopOrderIsTerminal,
  shopStockLabel,
  shopStockTone,
} from './shop-helpers'
import { productAudienceLabel } from './knowledge-helpers'

describe('shop helpers', () => {
  it('labels stock and audience for production UI', () => {
    expect(shopStockTone(0)).toBe('out')
    expect(shopStockLabel(0)).toBe('Нет в наличии')
    expect(shopStockTone(2)).toBe('low')
    expect(shopStockLabel(2, 'шт')).toContain('Мало')
    expect(shopStockTone(12)).toBe('ok')
    expect(productAudienceLabel('professional_only')).toBe('Только для салонов')
    expect(productAudienceLabel('all')).toBe('Для домашнего ухода')
    expect(productAudienceLabel('professional_only')).not.toContain('PROFESSIONAL')
  })

  it('clamps cart quantity and flags insufficient stock', () => {
    expect(nextCartQty(1, 1, 3)).toBe(2)
    expect(nextCartQty(3, 1, 3)).toBe(3)
    expect(nextCartQty(1, -1, 3)).toBe(0)
    expect(cartLineInsufficient(4, 2)).toBe(true)
    expect(shopLineTotal(2, 1500)).toBe(3000)
  })

  it('detects active catalog filters', () => {
    expect(shopHasActiveFilters('', '', '')).toBe(false)
    expect(shopHasActiveFilters('Estel', '', '')).toBe(true)
    expect(shopHasActiveFilters('', 'cat', '  ')).toBe(true)
  })

  it('treats completed and cancelled orders as terminal', () => {
    expect(shopOrderIsTerminal('cancelled')).toBe(true)
    expect(shopOrderIsTerminal('received')).toBe(true)
    expect(shopOrderIsTerminal('submitted')).toBe(false)
  })
})
