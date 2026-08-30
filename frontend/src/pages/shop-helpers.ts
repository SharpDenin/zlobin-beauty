export function shopStockLabel(available: number, unit?: string) {
  if (!Number.isFinite(available) || available <= 0) return 'Нет в наличии'
  if (available <= 3) return unit ? `Мало · ${available} ${unit}` : `Мало · ${available}`
  return unit ? `В наличии · ${available} ${unit}` : 'В наличии'
}

export function shopStockTone(available: number): 'ok' | 'low' | 'out' {
  if (!Number.isFinite(available) || available <= 0) return 'out'
  if (available <= 3) return 'low'
  return 'ok'
}

export function shopLineTotal(qty: number, priceMinor: number) {
  return Math.round(qty * priceMinor)
}

export function nextCartQty(current: number, delta: number, available: number) {
  const next = current + delta
  if (next <= 0) return 0
  if (Number.isFinite(available) && next > available) return available
  return next
}

export function cartLineInsufficient(qty: number, available: number) {
  return qty > available
}

export function shopHasActiveFilters(brand: string, categoryId: string, search: string) {
  return Boolean(brand || categoryId || search.trim())
}

export function shopOrderIsTerminal(status: string) {
  return status === 'cancelled' || status.startsWith('cancelled') || status === 'received' || status === 'delivered'
}
