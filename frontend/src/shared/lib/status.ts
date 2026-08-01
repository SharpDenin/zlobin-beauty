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
