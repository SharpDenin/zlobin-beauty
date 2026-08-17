export function isTerminalStatus(status?: string) {
  if (!status) return false
  return status === 'completed' || status === 'no_show' || status.startsWith('cancelled_')
}

export function canDragAppointment(status?: string, bookingMode?: string) {
  if (bookingMode === 'fixed_window') return false
  return status === 'pending_confirmation' || status === 'confirmed'
}

export function minutesToTime(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

export function staffRoleLabel(role?: string) {
  if (role === 'owner') return 'Владелец'
  if (role === 'admin') return 'Администратор'
  if (role === 'master') return 'Мастер'
  return 'Сотрудник'
}
