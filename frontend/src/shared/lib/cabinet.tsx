import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  hasMasterAccess,
  hasSalonAdmin,
  hasSupplierAccess,
  hasSupplierRepAccess,
  hasSystemAdmin,
  useAuth,
  type User,
} from '@/features/auth/AuthProvider'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useMyOrgs, type OrgItem } from '@/shared/lib/commerce'
import { workTypeLabel } from '@/shared/lib/status'

export type CabinetKind =
  | 'client'
  | 'private_master'
  | 'chair_master'
  | 'mobile_master'
  | 'salon_employee'
  | 'salon_owner'
  | 'chain_owner'
  | 'salon_admin'
  | 'supplier'
  | 'supplier_rep'
  | 'platform_admin'

export type NavLink = { to: string; label: string; end?: boolean }

export type MasterProfile = {
  id?: string
  work_type?: string
  display_name?: string
  city?: string
  organization_id?: string
  branch_id?: string
}

type CabinetState = {
  kind: CabinetKind
  label: string
  workType?: string
  master?: MasterProfile | null
  orgs: OrgItem[]
  selectedOrg: OrgItem | null
  selectedBranch: OrgItem['branches'][number] | null
  setSelectedOrgId: (id: string) => void
  setSelectedBranchId: (id: string) => void
  ready: boolean
  can: (feature: CabinetFeature) => boolean
  primary: NavLink[]
  secondary: NavLink[]
  side: NavLink[]
}

export type CabinetFeature =
  | 'staff'
  | 'reports'
  | 'cosmetics'
  | 'knowledge'
  | 'shop'
  | 'warehouse'
  | 'team'
  | 'analytics'
  | 'calendar'
  | 'clients'
  | 'services'
  | 'location'
  | 'pickup_orders'
  | 'salon_settings'

const CabinetContext = createContext<CabinetState | null>(null)

const ORG_KEY = 'sx.selectedOrg'
const BRANCH_KEY = 'sx.selectedBranch'

export function resolveCabinetKind(user: User | null | undefined, workType?: string): CabinetKind {
  if (!user) return 'client'
  if (hasSystemAdmin(user)) return 'platform_admin'
  if (hasSupplierAccess(user) && !hasMasterAccess(user)) return 'supplier'
  if (hasSupplierRepAccess(user) && !hasMasterAccess(user) && !hasSupplierAccess(user)) return 'supplier_rep'
  if (hasMasterAccess(user) || hasSalonAdmin(user)) {
    const wt = (workType || '').toLowerCase()
    if (wt === 'chain_owner') return 'chain_owner'
    if (wt === 'owner' || wt === 'salon_owner') return 'salon_owner'
    if (user.roles.includes('salon_admin') && wt !== 'owner' && wt !== 'salon_owner' && wt !== 'chain_owner') {
      return 'salon_admin'
    }
    if (wt === 'renter' || wt === 'chair_master') return 'chair_master'
    if (wt === 'mobile_master') return 'mobile_master'
    if (wt === 'employee') return 'salon_employee'
    if (wt === 'independent' || wt === 'private_master' || wt === '') return 'private_master'
    return 'private_master'
  }
  return 'client'
}

export function cabinetLabel(kind: CabinetKind) {
  switch (kind) {
    case 'platform_admin':
      return 'Администрирование платформы'
    case 'supplier':
      return 'Кабинет поставщика'
    case 'supplier_rep':
      return 'Кабинет представителя'
    case 'salon_owner':
      return 'Кабинет владельца салона'
    case 'chain_owner':
      return 'Кабинет владельца сети'
    case 'salon_admin':
      return 'Кабинет администратора'
    case 'chair_master':
      return 'Кабинет арендатора кресла'
    case 'mobile_master':
      return 'Кабинет выездного мастера'
    case 'salon_employee':
      return 'Кабинет мастера салона'
    case 'private_master':
      return 'Кабинет частного мастера'
    default:
      return 'Salon-X'
  }
}

function canFeature(kind: CabinetKind, feature: CabinetFeature) {
  const ownerLike = kind === 'salon_owner' || kind === 'chain_owner'
  switch (feature) {
    case 'staff':
      return ownerLike || kind === 'salon_admin'
    case 'reports':
      return ownerLike
    case 'cosmetics':
      return kind !== 'client' && kind !== 'supplier' && kind !== 'supplier_rep' && kind !== 'salon_admin'
    case 'knowledge':
      return kind !== 'client' && kind !== 'salon_admin'
    case 'salon_settings':
      return ownerLike
    case 'shop':
      return kind === 'client'
    case 'warehouse':
      return kind === 'supplier' || kind === 'supplier_rep'
    case 'team':
      return kind === 'supplier'
    case 'analytics':
      return ownerLike || kind === 'supplier' || kind === 'supplier_rep' || kind === 'private_master' || kind === 'chair_master' || kind === 'mobile_master' || kind === 'salon_employee'
    case 'calendar':
      return kind !== 'client' && kind !== 'supplier'
    case 'clients':
      return kind !== 'client' && kind !== 'supplier' && kind !== 'supplier_rep'
    case 'services':
      return kind !== 'client' && kind !== 'supplier' && kind !== 'supplier_rep' && kind !== 'salon_admin'
    case 'location':
      return kind === 'chair_master' || kind === 'mobile_master' || kind === 'salon_employee' || ownerLike
    case 'pickup_orders':
      return ownerLike || kind === 'salon_admin' || kind === 'salon_employee' || kind === 'chair_master'
    default:
      return false
  }
}

export function navForCabinet(kind: CabinetKind): { primary: NavLink[]; secondary: NavLink[]; side: NavLink[] } {
  if (kind === 'platform_admin') {
    const primary: NavLink[] = [
      { to: '/admin', label: 'Сводка', end: true },
      { to: '/admin/users', label: 'Пользователи' },
      { to: '/admin/organizations', label: 'Организации' },
      { to: '/more', label: 'Ещё' },
    ]
    const secondary: NavLink[] = [
      { to: '/admin/masters', label: 'Мастера' },
      { to: '/admin/suppliers', label: 'Поставщики' },
      { to: '/admin/products', label: 'Товары' },
      { to: '/admin/services', label: 'Услуги' },
      { to: '/admin/knowledge', label: 'База знаний' },
      { to: '/admin/appointments', label: 'Записи' },
      { to: '/admin/orders', label: 'Заказы' },
      { to: '/admin/disputes', label: 'Споры' },
      { to: '/admin/audit', label: 'Журнал' },
      { to: '/admin/catalogs', label: 'Справочники' },
      { to: '/profile', label: 'Профиль' },
    ]
    return { primary, secondary, side: [...primary.filter((l) => l.to !== '/more'), ...secondary] }
  }
  if (kind === 'supplier') {
    const primary: NavLink[] = [
      { to: '/supplier', label: 'Главная', end: true },
      { to: '/supplier/products', label: 'Товары' },
      { to: '/warehouse', label: 'Склад' },
      { to: '/more', label: 'Ещё' },
    ]
    const secondary: NavLink[] = [
      { to: '/supplier/orders', label: 'Заказы' },
      { to: '/supplier/client-orders', label: 'Заказы клиентов' },
      { to: '/supplier/analytics', label: 'Аналитика' },
      { to: '/supplier/team', label: 'Команда' },
      { to: '/supplier/recurring', label: 'Регулярные' },
      { to: '/messages', label: 'Сообщения' },
      { to: '/knowledge', label: 'База знаний' },
      { to: '/profile', label: 'Профиль' },
    ]
    return { primary, secondary, side: [...primary.filter((l) => l.to !== '/more'), ...secondary] }
  }
  if (kind === 'supplier_rep') {
    const primary: NavLink[] = [
      { to: '/rep', label: 'Сегодня', end: true },
      { to: '/rep/finance', label: 'Деньги' },
      { to: '/more', label: 'Ещё' },
    ]
    const secondary: NavLink[] = [
      { to: '/calendar', label: 'Календарь' },
      { to: '/messages', label: 'Сообщения' },
      { to: '/rep/analytics', label: 'Аналитика' },
      { to: '/warehouse', label: 'Склад' },
      { to: '/profile', label: 'Профиль' },
    ]
    return { primary, secondary, side: [...primary.filter((l) => l.to !== '/more'), ...secondary] }
  }
  if (kind === 'client') {
    const primary: NavLink[] = [
      { to: '/', label: 'Главная', end: true },
      { to: '/search', label: 'Мастера' },
      { to: '/shop', label: 'Магазин' },
      { to: '/appointments', label: 'Записи' },
      { to: '/more', label: 'Ещё' },
    ]
    const secondary: NavLink[] = [
      { to: '/messages', label: 'Сообщения' },
      { to: '/profile', label: 'Профиль' },
      { to: '/models', label: 'Модели' },
      { to: '/orders', label: 'Мои заказы' },
      { to: '/shop/cart', label: 'Корзина' },
    ]
    return { primary, secondary, side: [...primary.filter((l) => l.to !== '/more'), ...secondary] }
  }

  const primary: NavLink[] = [
    { to: '/', label: 'Сегодня', end: true },
    { to: '/calendar', label: 'Календарь' },
    { to: '/appointments', label: 'Записи' },
    { to: '/more', label: 'Ещё' },
  ]
  const secondary: NavLink[] = []
  secondary.push({ to: '/messages', label: 'Сообщения' })
  secondary.push({ to: '/masterclasses', label: 'Мастер-классы' })
  secondary.push({ to: '/models', label: 'Модели' })
  if (canFeature(kind, 'clients')) secondary.push({ to: '/clients', label: 'Клиенты' })
  if (canFeature(kind, 'services')) secondary.push({ to: '/services', label: 'Услуги' })
  if (canFeature(kind, 'cosmetics')) secondary.push({ to: '/cosmetics', label: 'Косметика' })
  if (canFeature(kind, 'cosmetics')) {
    secondary.push({ to: '/inventory', label: 'Мой склад' })
    secondary.push({ to: '/inventory/receipts', label: 'На приёмке' })
  }
  if (canFeature(kind, 'knowledge')) secondary.push({ to: '/knowledge', label: 'База знаний' })
  if (canFeature(kind, 'staff')) secondary.push({ to: '/staff', label: 'Команда' })
  if (canFeature(kind, 'pickup_orders')) secondary.push({ to: '/pickup-orders', label: 'Выдача заказов' })
  if (canFeature(kind, 'reports')) secondary.push({ to: '/reports', label: 'Аналитика' })
  if (canFeature(kind, 'salon_settings')) secondary.push({ to: '/salon/settings', label: 'Настройки' })
  secondary.push({ to: '/schedule', label: 'График' })
  secondary.push({ to: '/chairs', label: 'Аренда кресел' })
  if (kind === 'chain_owner' || kind === 'salon_owner' || kind === 'chair_master' || kind === 'mobile_master') {
    secondary.push({ to: '/master', label: 'Салон' })
  } else {
    secondary.push({ to: '/master', label: 'Профиль мастера' })
  }
  secondary.push({ to: '/profile', label: 'Профиль' })
  return { primary, secondary, side: [...primary.filter((l) => l.to !== '/more'), ...secondary] }
}

export function CabinetProvider({ children }: { children: ReactNode }) {
  const { user, accessToken } = useAuth()
  const orgs = useMyOrgs()
  const masterQ = useQuery({
    queryKey: ['me-master-cabinet'],
    queryFn: async () => {
      try {
        return await apiRequest<{ master: MasterProfile }>('/v1/me/master', { token: accessToken })
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) return { master: {} as MasterProfile }
        throw e
      }
    },
    enabled: Boolean(accessToken && (hasMasterAccess(user) || hasSalonAdmin(user))),
    retry: false,
  })

  const kind = resolveCabinetKind(user, masterQ.data?.master?.work_type)
  const nav = navForCabinet(kind)
  const orgItems = orgs.data?.items ?? []
  const [selectedOrgId, setSelectedOrgId] = useState(() => (typeof localStorage !== 'undefined' ? localStorage.getItem(ORG_KEY) : null))
  const [selectedBranchId, setSelectedBranchId] = useState(() => (typeof localStorage !== 'undefined' ? localStorage.getItem(BRANCH_KEY) : null))

  const selectedOrg = useMemo(() => {
    return orgItems.find((o) => o.organization.id === selectedOrgId) ?? orgItems[0] ?? null
  }, [orgItems, selectedOrgId])

  const selectedBranch = useMemo(() => {
    const branches = selectedOrg?.branches ?? []
    return branches.find((b) => b.id === selectedBranchId) ?? branches[0] ?? null
  }, [selectedOrg, selectedBranchId])

  const needsMaster = Boolean(accessToken && (hasMasterAccess(user) || hasSalonAdmin(user)))
  const ready = !needsMaster || masterQ.isFetched

  const value: CabinetState = {
    kind,
    label: cabinetLabel(kind),
    workType: masterQ.data?.master?.work_type,
    master: masterQ.data?.master ?? null,
    orgs: orgItems,
    selectedOrg,
    selectedBranch,
    setSelectedOrgId: (id) => {
      localStorage.setItem(ORG_KEY, id)
      setSelectedOrgId(id)
      window.dispatchEvent(new Event('sx-org-change'))
    },
    setSelectedBranchId: (id) => {
      localStorage.setItem(BRANCH_KEY, id)
      setSelectedBranchId(id)
      window.dispatchEvent(new Event('sx-org-change'))
    },
    ready,
    can: (feature) => canFeature(kind, feature),
    primary: nav.primary,
    secondary: nav.secondary,
    side: nav.side,
  }

  return <CabinetContext.Provider value={value}>{children}</CabinetContext.Provider>
}

export function useCabinet() {
  const ctx = useContext(CabinetContext)
  if (!ctx) {
    return {
      kind: 'client' as CabinetKind,
      label: 'Salon-X',
      workType: undefined,
      master: null,
      orgs: [],
      selectedOrg: null,
      selectedBranch: null,
      setSelectedOrgId: () => undefined,
      setSelectedBranchId: () => undefined,
      ready: true,
      can: () => false,
      primary: navForCabinet('client').primary,
      secondary: [] as NavLink[],
      side: navForCabinet('client').side,
    }
  }
  return ctx
}

export function workTypeHint(workType?: string) {
  return workTypeLabel(workType)
}
