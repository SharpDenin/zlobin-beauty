import type { CommerceProduct } from '@/shared/lib/commerce'

export type CartLine = { product: CommerceProduct; qty: number }

function key(supplierId: string) {
  return `zb.cosmetics.cart.${supplierId}`
}

export function loadCart(supplierId: string): CartLine[] {
  try {
    const raw = sessionStorage.getItem(key(supplierId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as CartLine[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveCart(supplierId: string, lines: CartLine[]) {
  sessionStorage.setItem(key(supplierId), JSON.stringify(lines))
}

export function clearCart(supplierId: string) {
  sessionStorage.removeItem(key(supplierId))
}

export function cartTotal(lines: CartLine[]) {
  return lines.reduce((sum, line) => sum + line.product.price_minor * line.qty, 0)
}

export function cartCount(lines: CartLine[]) {
  return lines.reduce((sum, line) => sum + line.qty, 0)
}

export function addToCart(lines: CartLine[], product: CommerceProduct, qty = 1): CartLine[] {
  const existing = lines.find((l) => l.product.id === product.id)
  if (existing) {
    return lines.map((l) => (l.product.id === product.id ? { ...l, qty: l.qty + qty } : l))
  }
  return [...lines, { product, qty }]
}

export function setCartQty(lines: CartLine[], productId: string, qty: number): CartLine[] {
  if (qty <= 0) return lines.filter((l) => l.product.id !== productId)
  return lines.map((l) => (l.product.id === productId ? { ...l, qty } : l))
}
