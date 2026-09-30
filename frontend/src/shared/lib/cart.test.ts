import { describe, expect, it } from 'vitest'
import { addToCart, cartCount, cartTotal, loadCart, saveCart, setCartQty, type CartLine } from './cart'
import type { CommerceProduct } from '@/shared/lib/commerce'

const product = (id: string, price = 1000): CommerceProduct =>
  ({
    id,
    organization_id: 'org',
    brand: 'Estel',
    name: `Product ${id}`,
    sku: id,
    unit: 'шт',
    volume_label: '250 мл',
    price_minor: price,
    currency: 'RUB',
    published: true,
  }) as CommerceProduct

describe('cosmetics cart helpers', () => {
  it('adds a line and merges quantity for the same product', () => {
    const a = addToCart([], product('p1'), 2)
    const b = addToCart(a, product('p1'), 1)
    expect(b).toEqual([{ product: product('p1'), qty: 3 }])
    expect(cartCount(b)).toBe(3)
    expect(cartTotal(b)).toBe(3000)
  })

  it('removes a line when qty drops to zero', () => {
    const lines: CartLine[] = [
      { product: product('p1'), qty: 2 },
      { product: product('p2', 500), qty: 1 },
    ]
    expect(setCartQty(lines, 'p1', 0)).toEqual([{ product: product('p2', 500), qty: 1 }])
    expect(setCartQty(lines, 'p2', 4)).toEqual([
      { product: product('p1'), qty: 2 },
      { product: product('p2', 500), qty: 4 },
    ])
  })

  it('clears session storage when saving an empty cart', () => {
    saveCart('s1', [{ product: product('p1'), qty: 1 }])
    expect(loadCart('s1')).toHaveLength(1)
    saveCart('s1', [])
    expect(sessionStorage.getItem('zb.cosmetics.cart.s1')).toBeNull()
    expect(loadCart('s1')).toEqual([])
  })
})
