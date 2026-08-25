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
  supplier_name?: string
  created_at: string
}

export type ReceiptLine = {
  product_id: string
  product_name?: string
  qty_ordered: number
  qty_delivered?: number
  qty_accepted?: number
  qty_damaged?: number
  qty_rejected?: number
  remaining_qty?: number
  receivable_qty?: number
  undelivered_qty?: number
}

export type ReceiptOrder = {
  id: string
  status: string
  comment?: string
  created_at: string
  supplier_name?: string
  supplier_org_id?: string
  acceptance_state?: string
  remaining_qty?: number
  undelivered_qty?: number
  items?: ReceiptLine[]
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
  if (m.ref_type === 'supplier_order' && m.ref_id) {
    const order = `заказ #${m.ref_id.slice(0, 8)}`
    return m.supplier_name ? `${order} · Поставщик: ${m.supplier_name}` : order
  }
  if (m.ref_type === 'appointment' && m.ref_id) return `визит #${m.ref_id.slice(0, 8)}`
  if (m.ref_type === 'service' && m.ref_id) return `услуга #${m.ref_id.slice(0, 8)}`
  return m.reason || ''
}

export function remainingToAccept(ordered: number, accepted: number, damaged: number, rejected: number) {
  return Math.max(0, ordered - accepted - damaged - rejected)
}

export function receivableQty(ordered: number, delivered: number, accepted: number, damaged: number, rejected: number) {
  const remaining = remainingToAccept(ordered, accepted, damaged, rejected)
  if (!delivered) return remaining
  const leftover = delivered - accepted - damaged - rejected
  if (leftover <= 1e-9) return remaining
  return Math.min(leftover, remaining)
}

export function discrepancyQty(ordered: number, delivered: number) {
  if (!delivered) return 0
  return Math.max(0, ordered - delivered)
}

export function acceptanceStateLabel(state?: string) {
  switch (state) {
    case 'in_progress':
      return 'На приёмке'
    case 'completed':
      return 'Принято'
    default:
      return 'Ожидает приёмки'
  }
}

export function receiptTotals(lines: Array<{ accepted: number; damaged: number; rejected: number }>) {
  const acc = { accepted: 0, damaged: 0, rejected: 0, stockIn: 0, notStock: 0 }
  for (const l of lines) {
    const accepted = Number(l.accepted) || 0
    const damaged = Number(l.damaged) || 0
    const rejected = Number(l.rejected) || 0
    acc.accepted += accepted
    acc.damaged += damaged
    acc.rejected += rejected
    acc.stockIn += accepted
    acc.notStock += damaged + rejected
  }
  return acc
}

export function lineNeedsCheck(remaining: number, accepted: number, damaged: number, rejected: number) {
  if (remaining <= 1e-9) return false
  return accepted + damaged + rejected > 1e-9
}

export function canCommitReceipt(lines: Array<{ remaining: number; accepted: number; damaged: number; rejected: number; checked: boolean }>) {
  const actionable = lines.filter((l) => lineNeedsCheck(l.remaining, l.accepted, l.damaged, l.rejected))
  if (actionable.length === 0) return false
  return actionable.every((l) => l.checked)
}
