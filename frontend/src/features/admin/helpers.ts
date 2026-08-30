export function roleLabel(role: string) {
  switch (role) {
    case 'system_admin':
      return 'Администратор платформы'
    case 'salon_admin':
      return 'Администратор салона'
    case 'salon_owner':
      return 'Владелец салона'
    case 'master':
      return 'Мастер'
    case 'supplier':
      return 'Поставщик'
    case 'supplier_rep':
      return 'Представитель'
    case 'client':
      return 'Клиент'
    default:
      return role
  }
}

export function statusLabel(status: string) {
  switch (status) {
    case 'active':
      return 'Активен'
    case 'blocked':
      return 'Заблокирован'
    case 'published':
      return 'Опубликован'
    case 'draft':
      return 'Черновик'
    case 'archived':
      return 'В архиве'
    case 'open':
      return 'Открыт'
    case 'resolved':
      return 'Решён'
    case 'rejected':
      return 'Отклонён'
    default:
      return status
  }
}

export function orgTypeLabel(type: string) {
  if (type === 'supplier') return 'Поставщик'
  if (type === 'salon') return 'Салон'
  return type
}

export function audienceLabel(audience: string) {
  if (audience === 'professional_only' || audience === 'professional') return 'Только для салонов'
  if (audience === 'all' || audience === 'home') return 'Для домашнего ухода'
  if (audience === 'mixed') return 'Смешанная'
  if (audience === 'unlinked') return 'Без товаров'
  return audience
}

export function knowledgeAudienceLabel(kind: string) {
  if (kind === 'home') return 'Для домашнего ухода'
  if (kind === 'professional') return 'Только для салонов'
  if (kind === 'mixed') return 'Смешанная'
  if (kind === 'unlinked') return 'Без товаров'
  return kind
}

export function auditActionLabel(action: string) {
  switch (action) {
    case 'user.blocked':
      return 'Заблокирован пользователь'
    case 'user.unblocked':
      return 'Разблокирован пользователь'
    case 'organization.published':
      return 'Опубликована организация'
    case 'organization.unpublished':
      return 'Снята публикация организации'
    case 'master.published':
      return 'Опубликован мастер'
    case 'master.unpublished':
      return 'Снята публикация мастера'
    case 'product.published':
      return 'Опубликован товар'
    case 'product.unpublished':
      return 'Снята публикация товара'
    case 'service.published':
      return 'Опубликована услуга'
    case 'service.unpublished':
      return 'Снята публикация услуги'
    case 'knowledge.status':
      return 'Изменён статус статьи'
    case 'dispute.resolved':
      return 'Спор решён'
    case 'dispute.rejected':
      return 'Спор отклонён'
    default:
      return action
  }
}

export function formatAdminDate(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function primaryRole(roles: string[] | undefined) {
  if (!roles?.length) return '—'
  const order = ['system_admin', 'salon_owner', 'salon_admin', 'supplier', 'supplier_rep', 'master', 'client']
  const found = order.find((r) => roles.includes(r))
  return roleLabel(found ?? roles[0])
}
