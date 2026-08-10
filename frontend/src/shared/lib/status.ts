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
  owner: 'Владелец точки',
  salon_owner: 'Владелец салона',
  independent: 'Частный мастер',
}

/** Prefer Russian action labels over raw status enums in supplier order buttons. */
export const supplierOrderActionLabel: Record<string, string> = {
  confirmed: 'Принять',
  picking: 'Собирается',
  in_transit: 'В пути',
  delivered: 'Доставлен',
  cancelled: 'Отменить',
}

const map: Record<string, string> = {
  ...appointmentMap,
  ...supplierOrderMap,
  ...clientOrderMap,
  ...productStateMap,
  ...stockStateMap,
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
  { value: 'owner', label: workTypeMap.owner },
  { value: 'salon_owner', label: workTypeMap.salon_owner },
  { value: 'independent', label: workTypeMap.independent },
] as const

export function statusBadgeClass(status: string) {
  if (status === 'confirmed' || status === 'delivered' || status === 'accepted_full' || status === 'published' || status === 'for_sale' || status === 'active' || status === 'ok') {
    return 'badge-confirmed'
  }
  if (status === 'pending_confirmation' || status === 'submitted' || status === 'new' || status === 'draft' || status === 'inactive' || status === 'low') {
    return 'badge-pending'
  }
  if (
    status === 'in_progress'
    || status === 'picking'
    || status === 'in_delivery'
    || status === 'in_transit'
    || status === 'accepted_partial'
  ) {
    return 'badge-progress'
  }
  if (status === 'completed') return 'badge-done'
  if (status.startsWith('cancelled') || status === 'no_show' || status === 'cancelled' || status === 'not_for_sale' || status === 'archived' || status === 'critical' || status === 'out' || status === 'out_of_stock') {
    return 'badge-cancelled'
  }
  return 'badge-default'
}
