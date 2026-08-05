const map: Record<string, string> = {
  pending_confirmation: 'Ожидает подтверждения',
  confirmed: 'Подтверждена',
  in_progress: 'В процессе',
  completed: 'Завершена',
  cancelled_by_client: 'Отменена клиентом',
  cancelled_by_master: 'Отменена мастером',
  cancelled_by_salon: 'Отменена салоном',
  no_show: 'Клиент не пришёл',
}

export function statusLabel(status: string) {
  return map[status] ?? status
}

export function statusBadgeClass(status: string) {
  if (status === 'confirmed') return 'badge-confirmed'
  if (status === 'pending_confirmation') return 'badge-pending'
  if (status === 'in_progress') return 'badge-progress'
  if (status === 'completed') return 'badge-done'
  if (status.startsWith('cancelled') || status === 'no_show') return 'badge-cancelled'
  return 'badge-default'
}
