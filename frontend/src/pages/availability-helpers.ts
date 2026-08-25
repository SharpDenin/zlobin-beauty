export type AvailabilityItem = {
  product_id: string
  product_name?: string
  brand?: string
  unit?: string
  required_qty: number
  on_hand?: number
  reserved?: number
  available?: number
  available_qty?: number
  incoming?: number
  incoming_qty?: number
  shortage?: number
  shortage_qty?: number
  status: string
  orderable?: boolean
}

export type AvailabilityAlternative = {
  available: boolean
  reason?: string
  product_id?: string
  product_name?: string
}

export type AvailabilityAnalysis = {
  service_id: string
  can_perform_now: boolean
  availability_status?: string
  items: AvailabilityItem[]
  alternative?: AvailabilityAlternative
}

export function itemAvailable(it: AvailabilityItem) {
  return it.available ?? it.available_qty ?? 0
}

export function itemIncoming(it: AvailabilityItem) {
  return it.incoming ?? it.incoming_qty ?? 0
}

export function itemShortage(it: AvailabilityItem) {
  return it.shortage ?? it.shortage_qty ?? 0
}

export function availabilityStatusLabel(status: string) {
  switch (status) {
    case 'available':
      return 'Хватает'
    case 'incoming':
      return 'Ожидается поставка'
    case 'orderable':
      return 'Можно заказать'
    case 'shortage':
      return 'Не хватает'
    case 'unavailable':
      return 'Невозможно получить'
    default:
      return status
  }
}

export function availabilityStatusMark(status: string) {
  switch (status) {
    case 'available':
      return '✓'
    case 'incoming':
      return '⚠'
    case 'orderable':
      return '→'
    case 'shortage':
    case 'unavailable':
      return '!'
    default:
      return '·'
  }
}

export function availabilityBadgeClass(status: string) {
  if (status === 'available') return 'badge-success'
  if (status === 'incoming' || status === 'orderable') return 'badge-warning'
  return 'badge-danger'
}

export function overallAvailabilityMessage(status?: string, canPerformNow?: boolean) {
  switch (status || (canPerformNow ? 'available' : 'shortage')) {
    case 'available':
      return 'Материалов хватает'
    case 'incoming':
      return 'Не хватает сейчас, закрывается ожидаемой поставкой'
    case 'orderable':
      return 'Не хватает, можно заказать'
    case 'unavailable':
      return 'Невозможно получить через текущие поставки'
    default:
      return 'Не хватает материалов'
  }
}

export function showOrderCta(it: AvailabilityItem) {
  return Boolean(it.orderable) && (it.status === 'orderable' || it.status === 'shortage' || it.status === 'unavailable')
}

export function cosmeticsProductPath(productId: string) {
  return `/cosmetics/products/${productId}`
}

export function alternativeMessage(alt?: AvailabilityAlternative) {
  if (!alt) return ''
  if (alt.available && alt.product_name) return `Есть вариант в линейке: ${alt.product_name}`
  return alt.reason || 'Нет сохранённой альтернативы'
}
