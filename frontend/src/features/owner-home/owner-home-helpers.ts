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
  if (can('cosmetics')) tiles.push({ to: '/inventory', label: 'Запасы', icon: 'warehouse' })
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
