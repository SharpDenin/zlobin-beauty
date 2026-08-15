const appointmentMap: Record<string, string> = {
  pending_confirmation: 'Ожидает подтверждения',
  confirmed: 'Подтверждена',
  in_progress: 'В процессе',
  completed: 'Завершена',
  cancelled_by_client: 'Отменена клиентом',
  cancelled_by_master: 'Отменена мастером',
  cancelled_by_salon: 'Отменена салоном',
  no_show: 'Клиент не пришёл',
}

const supplierOrderMap: Record<string, string> = {
  new: 'Новый',
  submitted: 'Оформлен',
  confirmed: 'Принят',
  picking: 'Собирается',
  in_transit: 'В пути',
  in_delivery: 'В доставке',
  delivered: 'Доставлен',
  accepted_partial: 'Принят частично',
  accepted_full: 'Принят полностью',
  cancelled: 'Отменён',
}

const paymentStatusMap: Record<string, string> = {
  pending: 'Ожидает оплаты',
  awaiting_payment: 'Ожидает оплаты',
  authorized: 'Авторизован',
  paid: 'Оплачен',
  partially_paid: 'Частично оплачен',
  failed: 'Ошибка оплаты',
  refunded: 'Возврат',
  cancelled: 'Отменён',
}

const deliveryStatusMap: Record<string, string> = {
  pending: 'Ожидает планирования',
  scheduled: 'Запланирована',
  preparing: 'Готовится',
  in_transit: 'В пути',
  arrived: 'Прибыла',
  delivered: 'Доставлена',
  failed: 'Сбой доставки',
  cancelled: 'Отменена',
}

const clientOrderMap: Record<string, string> = {
  submitted: 'Оформлен',
  confirmed: 'Подтверждён',
  picking: 'Собирается',
  in_delivery: 'В доставке',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
}

const productStateMap: Record<string, string> = {
  published: 'Опубликован',
  draft: 'Черновик',
  for_sale: 'В продаже',
  not_for_sale: 'Снят с продажи',
  archived: 'В архиве',
  active: 'Активна',
  inactive: 'Скрыта',
}

const stockStateMap: Record<string, string> = {
  ok: 'В норме',
  low: 'Мало',
  critical: 'Критично',
  out: 'Нет в наличии',
  out_of_stock: 'Нет в наличии',
}

const workTypeMap: Record<string, string> = {
  employee: 'Сотрудник салона',
  renter: 'Арендатор кресла',
  chair_master: 'Арендатор кресла',
  owner: 'Владелец точки',
  salon_owner: 'Владелец салона',
  chain_owner: 'Владелец сети',
  independent: 'Частный мастер',
  private_master: 'Частный мастер',
  mobile_master: 'Выездной мастер',
}

/** Prefer Russian action labels over raw status enums in supplier order buttons. */
export const supplierOrderActionLabel: Record<string, string> = {
  confirmed: 'Принять',
  picking: 'В сборку',
  ready_for_dispatch: 'Готов к отгрузке',
  cancelled: 'Отменить',
}

/** Physical delivery lifecycle — not commercial order status. */
export const deliveryActionLabel: Record<string, string> = {
  preparing: 'Готовить к отправке',
  in_transit: 'В путь',
  arrived: 'Прибыл',
  delivered: 'Выдан / доставлен',
}

const map: Record<string, string> = {
  ...appointmentMap,
  ...supplierOrderMap,
  ...clientOrderMap,
  ...productStateMap,
  ...stockStateMap,
  ...paymentStatusMap,
  ...deliveryStatusMap,
}

export function statusLabel(status: string) {
  return map[status] ?? status
}

export function appointmentStatusLabel(status: string) {
  return appointmentMap[status] ?? statusLabel(status)
}

export function supplierOrderLabel(status: string) {
  return supplierOrderMap[status] ?? statusLabel(status)
}

export function paymentStatusLabel(status: string | null | undefined) {
  if (!status) return '—'
  return paymentStatusMap[status] ?? statusLabel(status)
}

export function deliveryStatusLabel(status: string | null | undefined) {
  if (!status) return '—'
  return deliveryStatusMap[status] ?? statusLabel(status)
}

export function clientOrderLabel(status: string) {
  return clientOrderMap[status] ?? statusLabel(status)
}

export function productStateLabel(state: string) {
  return productStateMap[state] ?? state
}

export function workTypeLabel(workType: string | null | undefined) {
  if (!workType) return 'Не указан'
  return workTypeMap[workType] ?? workType
}

export const WORK_TYPE_OPTIONS = [
  { value: 'employee', label: workTypeMap.employee },
  { value: 'renter', label: workTypeMap.renter },
  { value: 'chair_master', label: workTypeMap.chair_master },
  { value: 'owner', label: workTypeMap.owner },
  { value: 'salon_owner', label: workTypeMap.salon_owner },
  { value: 'chain_owner', label: workTypeMap.chain_owner },
  { value: 'independent', label: workTypeMap.independent },
  { value: 'private_master', label: workTypeMap.private_master },
  { value: 'mobile_master', label: workTypeMap.mobile_master },
] as const

export function statusBadgeClass(status: string) {
  if (
    status === 'confirmed'
    || status === 'delivered'
    || status === 'accepted_full'
    || status === 'published'
    || status === 'for_sale'
    || status === 'active'
    || status === 'ok'
    || status === 'paid'
    || status === 'authorized'
    || status === 'arrived'
    || status === 'scheduled'
  ) {
    return 'badge-confirmed'
  }
  if (
    status === 'pending_confirmation'
    || status === 'submitted'
    || status === 'new'
    || status === 'draft'
    || status === 'inactive'
    || status === 'low'
    || status === 'pending'
    || status === 'awaiting_payment'
  ) {
    return 'badge-pending'
  }
  if (
    status === 'in_progress'
    || status === 'picking'
    || status === 'in_delivery'
    || status === 'in_transit'
    || status === 'accepted_partial'
    || status === 'preparing'
    || status === 'partially_paid'
  ) {
    return 'badge-progress'
  }
  if (status === 'completed') return 'badge-done'
  if (
    status.startsWith('cancelled')
    || status === 'no_show'
    || status === 'cancelled'
    || status === 'not_for_sale'
    || status === 'archived'
    || status === 'critical'
    || status === 'out'
    || status === 'out_of_stock'
    || status === 'failed'
    || status === 'refunded'
  ) {
    return 'badge-cancelled'
  }
  return 'badge-default'
}
