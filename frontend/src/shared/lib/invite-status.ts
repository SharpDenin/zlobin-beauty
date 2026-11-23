export type InviteStatus = 'active' | 'accepted' | 'revoked' | 'expired' | 'exhausted'

export function inviteStatusLabel(status: string): string {
  switch (status) {
    case 'active':
      return 'Активно'
    case 'accepted':
      return 'Принято'
    case 'revoked':
      return 'Отозвано'
    case 'expired':
      return 'Истекло'
    case 'exhausted':
      return 'Использовано'
    default:
      return status
  }
}

export function inviteRoleLabel(role: string): string {
  switch (role) {
    case 'admin':
      return 'Администратор'
    case 'staff':
      return 'Сотрудник'
    case 'master':
      return 'Мастер'
    case 'client':
      return 'Клиент'
    default:
      return role
  }
}
