import { unitLabel } from '@/shared/lib/labels'

export type InventoryItem = {
  product_id: string
  product_name: string
  brand: string
  sku?: string
  unit: string
  volume_label?: string
  qty_on_hand: number
  qty_reserved?: number
  available: number
  qty_incoming?: number
  status: string
}

export type InventoryMovement = {
  id: string
  kind: string
  qty: number
  qty_before?: number
  qty_after?: number
  reason: string
  product_id: string
  actor_user_id?: string
  ref_type?: string
  ref_id?: string | null
  created_at: string
}

export function formatQty(qty: number, unit?: string) {
  const n = Number.isInteger(qty) ? String(qty) : qty.toFixed(3).replace(/\.?0+$/, '')
  const u = unitLabel(unit)
  return u ? `${n} ${u}` : n
}

export function movementTitle(kind: string) {
  switch (kind) {
    case 'receipt':
      return 'Приёмка'
    case 'consumption':
      return 'Расход'
    case 'adjust':
      return 'Корректировка'
    case 'damage':
      return 'Повреждено'
    case 'rejection':
      return 'Отклонено'
    case 'write_off':
      return 'Списание'
    case 'return':
      return 'Возврат'
    default:
      return kind
  }
}

export function movementDelta(kind: string, qty: number) {
  const abs = Math.abs(qty)
  if (kind === 'damage' || kind === 'rejection') return `−${abs} (не на складе)`
  if (qty > 0) return `+${abs}`
  if (qty < 0) return `−${abs}`
  return '0'
}

export function movementContext(m: InventoryMovement) {
  if (m.ref_type === 'supplier_order' && m.ref_id) return `заказ #${m.ref_id.slice(0, 8)}`
  if (m.ref_type === 'appointment' && m.ref_id) return `визит #${m.ref_id.slice(0, 8)}`
  if (m.ref_type === 'service' && m.ref_id) return `услуга #${m.ref_id.slice(0, 8)}`
  return m.reason || ''
}

export function remainingToAccept(ordered: number, accepted: number, damaged: number, rejected: number) {
  return Math.max(0, ordered - accepted - damaged - rejected)
}
