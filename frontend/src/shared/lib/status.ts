const map: Record<string, string> = {
  pending_confirmation: 'Ожидает подтверждения',
  confirmed: 'Подтверждена',
  in_progress: 'В процессе',
  completed: 'Завершена',
  cancelled_by_client: 'Отменена клиентом',
  cancelled_by_master: 'Отменена мастером',
  cancelled_by_salon: 'Отменена салоном',
  no_show: 'Клиент не пришёл',
  new: 'Новый',
  submitted: 'Оформлен',
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

export function statusLabel(status: string) {
  return map[status] ?? status
}

export function clientOrderLabel(status: string) {
  return clientOrderMap[status] ?? statusLabel(status)
}

export function statusBadgeClass(status: string) {
  if (status === 'confirmed' || status === 'delivered' || status === 'accepted_full') return 'badge-confirmed'
  if (status === 'pending_confirmation' || status === 'submitted' || status === 'new') return 'badge-pending'
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
  if (status.startsWith('cancelled') || status === 'no_show' || status === 'cancelled') return 'badge-cancelled'
  return 'badge-default'
}
