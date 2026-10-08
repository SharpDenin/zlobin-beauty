import type { CabinetFeature, CabinetKind } from '@/shared/lib/cabinet'

export function isOwnerStartKind(kind: CabinetKind | string): boolean {
  return kind === 'salon_owner' || kind === 'chain_owner' || kind === 'salon_admin'
}

export function weekDays(anchor = new Date()): Date[] {
  const d = new Date(anchor)
  d.setHours(12, 0, 0, 0)
  const mondayOffset = (d.getDay() + 6) % 7
  const monday = new Date(d)
  monday.setDate(d.getDate() - mondayOffset)
  return Array.from({ length: 7 }, (_, i) => {
    const next = new Date(monday)
    next.setDate(monday.getDate() + i)
    return next
  })
}

export function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function sameCalendarDay(iso: string, day: Date): boolean {
  const at = new Date(iso)
  return at.getFullYear() === day.getFullYear() && at.getMonth() === day.getMonth() && at.getDate() === day.getDate()
}

export function shortPersonName(name?: string | null): string {
  const raw = (name ?? '').trim()
  if (!raw) return ''
  const parts = raw.split(/\s+/)
  if (parts.length === 1) return parts[0]
  const initial = parts[1].slice(0, 1)
  return initial ? `${parts[0]} ${initial}.` : parts[0]
}

export function formatOwnerDate(d = new Date()): string {
  const today = new Date()
  const same = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()
  const rest = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  return same ? `Сегодня · ${rest}` : rest
}

export type OwnerTile = {
  to: string
  label: string
  icon: 'staff' | 'money' | 'warehouse' | 'settings' | 'clients' | 'services'
}

export function ownerManagementTiles(can: (feature: CabinetFeature) => boolean): OwnerTile[] {
  const tiles: OwnerTile[] = []
  if (can('staff')) tiles.push({ to: '/staff', label: 'Команда', icon: 'staff' })
  if (can('reports')) tiles.push({ to: '/reports', label: 'Финансы', icon: 'money' })
  if (can('cosmetics')) tiles.push({ to: '/inventory', label: 'Склад', icon: 'warehouse' })
  if (can('salon_settings')) tiles.push({ to: '/salon/settings', label: 'Настройки', icon: 'settings' })
  if (tiles.length < 4 && can('clients')) tiles.push({ to: '/clients', label: 'Клиенты', icon: 'clients' })
  if (tiles.length < 4 && can('services')) tiles.push({ to: '/services', label: 'Услуги', icon: 'services' })
  return tiles.slice(0, 4)
}

export function pendingConfirmLabel(count: number): string {
  if (count === 1) return '1 запись ждёт подтверждения'
  if (count >= 2 && count <= 4) return `${count} записи ждут подтверждения`
  return `${count} записей ждут подтверждения`
}

export function isDemoAccount(email?: string | null): boolean {
  return Boolean(email && /@demo\.local$/i.test(email))
}

export type HomeAudience = 'salon' | 'master' | 'client' | 'supplier' | 'rep' | 'admin'

export function homeAudience(kind: string): HomeAudience {
  if (kind === 'salon_owner' || kind === 'chain_owner' || kind === 'salon_admin') return 'salon'
  if (kind === 'supplier') return 'supplier'
  if (kind === 'supplier_rep') return 'rep'
  if (kind === 'platform_admin') return 'admin'
  if (kind === 'client') return 'client'
  return 'master'
}

export function homeShowsSchedule(kind: string): boolean {
  const audience = homeAudience(kind)
  return audience === 'salon' || audience === 'master' || audience === 'client'
}

export function homeTiles(kind: string, can: (feature: CabinetFeature) => boolean): OwnerTile[] {
  const audience = homeAudience(kind)
  if (audience === 'salon') return ownerManagementTiles(can)
  if (audience === 'supplier') {
    return [
      { to: '/supplier/products', label: 'Товары', icon: 'warehouse' },
      { to: '/warehouse', label: 'Склад', icon: 'warehouse' },
      { to: '/supplier/orders', label: 'Заказы', icon: 'services' },
      { to: '/supplier/analytics', label: 'Аналитика', icon: 'money' },
    ]
  }
  if (audience === 'rep') {
    return [
      { to: '/rep', label: 'Смена', icon: 'staff' },
      { to: '/calendar', label: 'Календарь', icon: 'services' },
      { to: '/warehouse', label: 'Склад', icon: 'warehouse' },
      { to: '/rep/finance', label: 'Деньги', icon: 'money' },
    ]
  }
  if (audience === 'admin') {
    return [
      { to: '/admin', label: 'Сводка', icon: 'money' },
      { to: '/admin/users', label: 'Пользователи', icon: 'staff' },
      { to: '/admin/appointments', label: 'Записи', icon: 'services' },
      { to: '/admin/orders', label: 'Заказы', icon: 'warehouse' },
    ]
  }
  if (audience === 'client') {
    return [
      { to: '/search', label: 'Мастера', icon: 'staff' },
      { to: '/appointments', label: 'Записи', icon: 'services' },
      { to: '/shop', label: 'Магазин', icon: 'warehouse' },
      { to: '/messages', label: 'Сообщения', icon: 'clients' },
    ]
  }
  const tiles: OwnerTile[] = [{ to: '/appointments', label: 'Записи', icon: 'services' }]
  if (can('clients')) tiles.push({ to: '/clients', label: 'Клиенты', icon: 'clients' })
  if (can('services')) tiles.push({ to: '/services', label: 'Услуги', icon: 'settings' })
  tiles.push({ to: '/dashboard', label: 'Рабочий стол', icon: 'money' })
  if (tiles.length < 4) tiles.push({ to: '/calendar', label: 'Календарь', icon: 'services' })
  return tiles.slice(0, 4)
}

export function scheduleHeading(selected: Date, today = new Date()): string {
  const same = selected.getFullYear() === today.getFullYear()
    && selected.getMonth() === today.getMonth()
    && selected.getDate() === today.getDate()
  if (same) return 'Записи на сегодня'
  const rest = selected.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  return `Записи · ${rest}`
}
