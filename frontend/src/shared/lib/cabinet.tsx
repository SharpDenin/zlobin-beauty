import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  hasMasterAccess,
  hasSupplierAccess,
  hasSupplierRepAccess,
  hasSystemAdmin,
  useAuth,
  type User,
} from '@/features/auth/AuthProvider'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useMyOrgs, type OrgItem } from '@/shared/lib/commerce'
import { usePreference } from '@/shared/lib/preferences'
import { hasLegacyEmployeeFormat, uniqueCanonicalWorkTypes, workTypeLabel } from '@/shared/lib/work-types'

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
  work_types?: string[]
  display_name?: string
  city?: string
  organization_id?: string
  branch_id?: string
}

/**
 * Orthogonal capability flags — independent of UI interaction mode and work formats.
 * Owner/admin *actions* require active membership. Legacy work_type / identity claims
 * only drive shell navigation (kind), never action gates in `can()`.
 */
export type UserCapabilities = {
  isClient: boolean
  isMaster: boolean
  /** Active membership role=owner — gates staff/reports/salon_settings. */
  isSalonOwner: boolean
  /** Active membership role=admin — gates admin actions. */
  isSalonAdmin: boolean
  isSalonMasterMember: boolean
  /** Two+ salons with active owner membership — org switcher. */
  isChainOps: boolean
  isSupplier: boolean
  isSupplierRep: boolean
  isPlatformAdmin: boolean
  /** Pre-migration work_type ownership codes — display shell only. */
  legacyOwnerShell: 'salon_owner' | 'chain_owner' | null
  /** Identity role salon_owner without (or before) membership sync — display shell only. */
  identityOwnerClaim: boolean
  workFormats: string[]
  hasLegacyEmployeeFormat: boolean
}

export type InteractionMode = 'master' | 'client'

export const INTERACTION_MODE_PREF_KEY = 'ui.interaction_mode'

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

type CabinetState = {
  kind: CabinetKind
  label: string
  workType?: string
  workTypes: string[]
  capabilities: UserCapabilities
  interactionMode: InteractionMode
  setInteractionMode: (mode: InteractionMode) => void
  canUseMasterMode: boolean
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

const CabinetContext = createContext<CabinetState | null>(null)

const ORG_KEY = 'sx.selectedOrg'
const BRANCH_KEY = 'sx.selectedBranch'

function salonOrgs(orgs: OrgItem[]) {
  return orgs.filter((o) => o.organization.type !== 'supplier')
}

function hasOrgRole(orgs: OrgItem[], role: string) {
  return salonOrgs(orgs).some((o) => o.roles.map((r) => r.toLowerCase()).includes(role))
}

function ownedSalonCount(orgs: OrgItem[]) {
  return salonOrgs(orgs).filter((o) => o.roles.map((r) => r.toLowerCase()).includes('owner')).length
}

/** Soft legacy hint: ownership historically stored as work_type until data migration. */
export function legacyOwnershipFromWorkType(workType?: string): 'chain_owner' | 'salon_owner' | null {
  const wt = (workType || '').toLowerCase()
  if (wt === 'chain_owner') return 'chain_owner'
  if (wt === 'owner' || wt === 'salon_owner') return 'salon_owner'
  return null
}

export function resolveCapabilities(
  user: User | null | undefined,
  orgs: OrgItem[] = [],
  master?: MasterProfile | null,
): UserCapabilities {
  const formats = uniqueCanonicalWorkTypes(
    master?.work_types?.length
      ? master.work_types
      : master?.work_type
        ? [master.work_type]
        : [],
  )
  const legacyOwnerShell = legacyOwnershipFromWorkType(master?.work_type)
  const identityOwnerClaim = Boolean(user?.roles.includes('salon_owner')) && !hasOrgRole(orgs, 'owner')
  const isPlatformAdmin = hasSystemAdmin(user)
  const isSupplier = Boolean(user && hasSupplierAccess(user) && !hasMasterAccess(user))
  const isSupplierRep = Boolean(
    user && hasSupplierRepAccess(user) && !hasMasterAccess(user) && !hasSupplierAccess(user),
  )
  // Action capabilities: only active membership from /organizations/mine (status=active).
  const isSalonOwner = hasOrgRole(orgs, 'owner')
  const isSalonAdmin = hasOrgRole(orgs, 'admin') && !isSalonOwner
  const isSalonMasterMember =
    hasOrgRole(orgs, 'master') && !isSalonOwner && !isSalonAdmin
  // REG-03: owner/admin membership and legacy owner shell do NOT imply master capabilities.
  const isMaster =
    Boolean(user?.roles.includes('master'))
    || Boolean(master?.id)
    || isSalonMasterMember
  const isChainOps = ownedSalonCount(orgs) > 1

  return {
    isClient: Boolean(user && user.status === 'active'),
    isMaster,
    isSalonOwner,
    isSalonAdmin,
    isSalonMasterMember,
    isChainOps,
    isSupplier,
    isSupplierRep,
    isPlatformAdmin,
    legacyOwnerShell,
    identityOwnerClaim,
    workFormats: formats,
    hasLegacyEmployeeFormat: hasLegacyEmployeeFormat(
      master?.work_types?.length ? master.work_types : master?.work_type,
    ),
  }
}

/** True when shell should look like owner/chain even without membership-backed actions. */
export function hasOwnerShell(caps: UserCapabilities): boolean {
  return caps.isSalonOwner || caps.identityOwnerClaim || caps.legacyOwnerShell != null
}

export type ResolveCabinetOpts = {
  orgs?: OrgItem[]
  master?: MasterProfile | null
  interactionMode?: InteractionMode
  /** @deprecated soft fallback for pre-migration ownership codes */
  workType?: string
}

/**
 * Preferred home/nav context. Ownership and staff come from membership/identity,
 * not from work_type. Second arg may be legacy workType string for call-site compat.
 */
export function resolveCabinetKind(
  user: User | null | undefined,
  workTypeOrOpts?: string | ResolveCabinetOpts,
): CabinetKind {
  const opts: ResolveCabinetOpts =
    typeof workTypeOrOpts === 'string' ? { workType: workTypeOrOpts } : workTypeOrOpts ?? {}
  const master = opts.master ?? (opts.workType ? { work_type: opts.workType } : null)
  const caps = resolveCapabilities(user, opts.orgs ?? [], master)
  const mode = opts.interactionMode ?? 'master'

  if (!user) return 'client'
  if (caps.isPlatformAdmin) return 'platform_admin'
  if (caps.isSupplier) return 'supplier'
  if (caps.isSupplierRep) return 'supplier_rep'

  if (mode === 'client' && caps.isClient) {
    return 'client'
  }

  // Owner shell: membership owner, or legacy/identity display-only hints (actions stay gated by can()).
  if (hasOwnerShell(caps)) {
    if (caps.isChainOps || caps.legacyOwnerShell === 'chain_owner') return 'chain_owner'
    return 'salon_owner'
  }
  if (caps.isSalonAdmin || (user.roles.includes('salon_admin') && hasOrgRole(opts.orgs ?? [], 'admin'))) {
    return 'salon_admin'
  }
  // Identity salon_admin without membership: do not elevate to admin shell (no org to administer).
  if (caps.isSalonMasterMember) return 'salon_employee'
  if (caps.isMaster) {
    // Soft UX hint from formats (not exclusive cabinet roles)
    if (caps.workFormats.includes('chair_rental') && caps.workFormats.length === 1) return 'chair_master'
    if (caps.workFormats.includes('mobile_service') && caps.workFormats.length === 1) return 'mobile_master'
    return 'private_master'
  }
  return 'client'
}

export function cabinetLabel(kind: CabinetKind) {
  switch (kind) {
    case 'platform_admin':
      return 'Администрирование платформы'
    case 'supplier':
      return 'Поставщик'
    case 'supplier_rep':
      return 'Представитель'
    case 'salon_owner':
      return 'Владелец салона'
    case 'chain_owner':
      return 'Владелец сети'
    case 'salon_admin':
      return 'Администратор салона'
    case 'chair_master':
      return 'Аренда кресла'
    case 'mobile_master':
      return 'Выездной мастер'
    case 'salon_employee':
      return 'Мастер салона'
    case 'private_master':
      return 'Частный мастер'
    default:
      return 'Salon-X'
  }
}

/** Action gates — membership-backed only for owner/admin features (never legacy shell alone). */
export function canFeatureFromCaps(caps: UserCapabilities, feature: CabinetFeature): boolean {
  const ownerLike = caps.isSalonOwner
  const adminLike = caps.isSalonAdmin
  const masterLike = caps.isMaster && !caps.isSupplier && !caps.isSupplierRep && !caps.isPlatformAdmin
  switch (feature) {
    case 'staff':
      return ownerLike || adminLike
    case 'reports':
      return ownerLike
    case 'cosmetics':
      return masterLike && !adminLike
    case 'knowledge':
      return (masterLike || caps.isSupplier || caps.isSupplierRep) && !adminLike
    case 'salon_settings':
      return ownerLike
    case 'shop':
      return caps.isClient
    case 'warehouse':
      return caps.isSupplier || caps.isSupplierRep
    case 'team':
      return caps.isSupplier
    case 'analytics':
      return ownerLike || caps.isSupplier || caps.isSupplierRep || masterLike
    case 'calendar':
      return masterLike || ownerLike || adminLike
    case 'clients':
      return masterLike || ownerLike || adminLike
    case 'services':
      return masterLike && !adminLike
    case 'location':
      return ownerLike || caps.isSalonMasterMember || caps.workFormats.includes('chair_rental') || caps.workFormats.includes('mobile_service')
    case 'pickup_orders':
      return ownerLike || adminLike || caps.isSalonMasterMember || caps.workFormats.includes('chair_rental')
    default:
      return false
  }
}

/** Kind-based feature gate used by nav builders (kind already encodes preferred context). */
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

export function navForCabinet(
  kind: CabinetKind,
  /** When set, owner/admin action links follow membership-backed can() instead of kind alone. */
  actionCan?: (feature: CabinetFeature) => boolean,
): { primary: NavLink[]; secondary: NavLink[]; side: NavLink[] } {
  const check = (feature: CabinetFeature) => (actionCan ? actionCan(feature) : canFeature(kind, feature))
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
      { to: '/settings', label: 'Настройки' },
      { to: '/profile', label: 'Профиль' },
    ]
    return { primary, secondary, side: [...primary.filter((l) => l.to !== '/more'), ...secondary] }
  }
  if (kind === 'supplier') {
    const primary: NavLink[] = [
      { to: '/', label: 'Главная', end: true },
      { to: '/supplier/products', label: 'Товары' },
      { to: '/warehouse', label: 'Склад' },
      { to: '/more', label: 'Ещё' },
    ]
    const secondary: NavLink[] = [
      { to: '/supplier', label: 'Компания' },
      { to: '/supplier/orders', label: 'Заказы' },
      { to: '/supplier/client-orders', label: 'Заказы клиентов' },
      { to: '/supplier/analytics', label: 'Аналитика' },
      { to: '/supplier/team', label: 'Команда' },
      { to: '/supplier/recurring', label: 'Регулярные' },
      { to: '/messages', label: 'Сообщения' },
      { to: '/contacts', label: 'Контакты' },
      { to: '/knowledge', label: 'База знаний' },
      { to: '/settings', label: 'Настройки' },
      { to: '/profile', label: 'Профиль' },
    ]
    return { primary, secondary, side: [...primary.filter((l) => l.to !== '/more'), ...secondary] }
  }
  if (kind === 'supplier_rep') {
    const primary: NavLink[] = [
      { to: '/', label: 'Главная', end: true },
      { to: '/rep', label: 'Сегодня' },
      { to: '/more', label: 'Ещё' },
    ]
    const secondary: NavLink[] = [
      { to: '/rep/finance', label: 'Деньги' },
      { to: '/calendar', label: 'Календарь' },
      { to: '/messages', label: 'Сообщения' },
      { to: '/contacts', label: 'Контакты' },
      { to: '/rep/analytics', label: 'Аналитика' },
      { to: '/warehouse', label: 'Склад' },
      { to: '/settings', label: 'Настройки' },
      { to: '/profile', label: 'Профиль' },
    ]
    return { primary, secondary, side: [...primary.filter((l) => l.to !== '/more'), ...secondary] }
  }
  if (kind === 'client') {
    const primary: NavLink[] = [
      { to: '/', label: 'Главная', end: true },
      { to: '/search', label: 'Поиск мастера' },
      { to: '/shop', label: 'Магазин' },
      { to: '/appointments', label: 'Записи' },
      { to: '/more', label: 'Ещё' },
    ]
    const secondary: NavLink[] = [
      { to: '/messages', label: 'Сообщения' },
      { to: '/contacts', label: 'Контакты' },
      { to: '/settings', label: 'Настройки' },
      { to: '/profile', label: 'Профиль' },
      { to: '/models', label: 'Модели' },
      { to: '/orders', label: 'Мои заказы' },
      { to: '/shop/cart', label: 'Корзина' },
    ]
    return { primary, secondary, side: [...primary.filter((l) => l.to !== '/more'), ...secondary] }
  }

  const ownerHome = kind === 'salon_owner' || kind === 'chain_owner' || kind === 'salon_admin'
  const primary: NavLink[] = [
    { to: '/', label: ownerHome ? 'Обзор' : 'Сегодня', end: true },
    { to: '/calendar', label: ownerHome ? 'Расписание' : 'Календарь' },
    { to: '/appointments', label: 'Записи' },
    { to: '/more', label: 'Ещё' },
  ]
  const secondary: NavLink[] = []
  secondary.push({ to: '/messages', label: 'Сообщения' })
  secondary.push({ to: '/contacts', label: 'Контакты' })
  secondary.push({ to: '/portfolio', label: 'Портфолио' })
  secondary.push({ to: '/masterclasses', label: 'Мастер-классы' })
  secondary.push({ to: '/models', label: 'Модели' })
  if (check('clients')) secondary.push({ to: '/clients', label: 'Клиенты' })
  if (check('services')) secondary.push({ to: '/services', label: 'Услуги' })
  if (check('cosmetics')) secondary.push({ to: '/cosmetics', label: 'Косметика' })
  if (check('cosmetics')) {
    secondary.push({ to: '/inventory', label: 'Мой склад' })
    secondary.push({ to: '/inventory/receipts', label: 'На приёмке' })
  }
  if (check('knowledge')) secondary.push({ to: '/knowledge', label: 'База знаний' })
  if (check('staff')) secondary.push({ to: '/staff', label: 'Команда' })
  if (check('staff')) secondary.push({ to: '/staff/invite', label: 'Пригласить мастера' })
  if (check('pickup_orders')) secondary.push({ to: '/pickup-orders', label: 'Выдача заказов' })
  if (check('reports')) secondary.push({ to: '/reports', label: 'Аналитика' })
  if (check('salon_settings')) secondary.push({ to: '/salon/settings', label: 'Настройки салона' })
  secondary.push({ to: '/schedule', label: 'График' })
  secondary.push({ to: '/chairs', label: 'Аренда кресел' })
  if (kind === 'chain_owner' || kind === 'salon_owner' || kind === 'chair_master' || kind === 'mobile_master') {
    secondary.push({ to: '/master', label: 'Салон' })
  } else {
    secondary.push({ to: '/master', label: 'Профиль мастера' })
  }
  secondary.push({ to: '/settings', label: 'Настройки' })
  secondary.push({ to: '/profile', label: 'Профиль' })
  if (kind === 'private_master' || kind === 'chair_master' || kind === 'mobile_master' || kind === 'salon_employee') {
    secondary.push({ to: '/dashboard', label: 'Рабочий стол' })
  }
  return { primary, secondary, side: [...primary.filter((l) => l.to !== '/more'), ...secondary] }
}

export function applyNavOrder(links: NavLink[], order: string[]): NavLink[] {
  if (!order.length) return links
  const more = links.filter((l) => l.to === '/more')
  const rest = links.filter((l) => l.to !== '/more')
  const byTo = new Map(rest.map((l) => [l.to, l] as const))
  const out: NavLink[] = []
  for (const to of order) {
    const item = byTo.get(to)
    if (item) {
      out.push(item)
      byTo.delete(to)
    }
  }
  for (const item of rest) {
    if (byTo.has(item.to)) out.push(item)
  }
  return [...out, ...more]
}

export function moveNavPath(order: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) return order
  const next = [...order]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

function emptyCapabilities(): UserCapabilities {
  return {
    isClient: false,
    isMaster: false,
    isSalonOwner: false,
    isSalonAdmin: false,
    isSalonMasterMember: false,
    isChainOps: false,
    isSupplier: false,
    isSupplierRep: false,
    isPlatformAdmin: false,
    legacyOwnerShell: null,
    identityOwnerClaim: false,
    workFormats: [],
    hasLegacyEmployeeFormat: false,
  }
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
    enabled: Boolean(accessToken && (user?.roles.includes('master') || user?.roles.includes('salon_admin'))),
    retry: false,
  })

  const orgItems = orgs.data?.items ?? []
  const master = masterQ.data?.master ?? null
  const capabilities = useMemo(
    () => resolveCapabilities(user, orgItems, master),
    [user, orgItems, master],
  )

  // REG-03: master UI mode only when real master capabilities exist (not owner membership alone).
  const canUseMasterMode = capabilities.isMaster || capabilities.isPlatformAdmin

  const [modePref, setModePref] = usePreference<InteractionMode | ''>(INTERACTION_MODE_PREF_KEY, '')
  const interactionMode: InteractionMode = (() => {
    if (modePref === 'client') return 'client'
    if (modePref === 'master') return canUseMasterMode ? 'master' : 'client'
    return canUseMasterMode ? 'master' : 'client'
  })()

  const setInteractionMode = (mode: InteractionMode) => {
    if (mode === 'master' && !canUseMasterMode) return
    setModePref(mode)
  }

  const kind = resolveCabinetKind(user, {
    orgs: orgItems,
    master,
    interactionMode,
  })
  const actionCan = (feature: CabinetFeature) => canFeatureFromCaps(capabilities, feature)
  const nav = navForCabinet(kind, actionCan)
  const [navOrder] = usePreference<string[]>('nav.order', [])
  const side = applyNavOrder(nav.side, navOrder)
  const primaryTargets = new Set(nav.primary.map((l) => l.to))
  const primary = [
    ...side.filter((l) => primaryTargets.has(l.to) && l.to !== '/more'),
    ...nav.primary.filter((l) => l.to === '/more'),
  ]
  const secondary = side.filter((l) => l.to !== '/more')
  const [selectedOrgId, setSelectedOrgId] = useState(() => (typeof localStorage !== 'undefined' ? localStorage.getItem(ORG_KEY) : null))
  const [selectedBranchId, setSelectedBranchId] = useState(() => (typeof localStorage !== 'undefined' ? localStorage.getItem(BRANCH_KEY) : null))

  const selectedOrg = useMemo(() => {
    return orgItems.find((o) => o.organization.id === selectedOrgId) ?? orgItems[0] ?? null
  }, [orgItems, selectedOrgId])

  const selectedBranch = useMemo(() => {
    const branches = selectedOrg?.branches ?? []
    return branches.find((b) => b.id === selectedBranchId) ?? branches[0] ?? null
  }, [selectedOrg, selectedBranchId])

  const needsMaster = Boolean(accessToken && (user?.roles.includes('master') || user?.roles.includes('salon_admin')))
  const ready = !needsMaster || masterQ.isFetched

  const workTypes = capabilities.workFormats
  const workType = master?.work_type || workTypes[0]

  const value: CabinetState = {
    kind,
    label: cabinetLabel(kind),
    workType,
    workTypes,
    capabilities,
    interactionMode,
    setInteractionMode,
    canUseMasterMode,
    master,
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
    // ACL-facing features follow capabilities, not the temporary UI mode.
    can: (feature) => canFeatureFromCaps(capabilities, feature),
    primary,
    secondary,
    side,
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
      workTypes: [] as string[],
      capabilities: emptyCapabilities(),
      interactionMode: 'client' as InteractionMode,
      setInteractionMode: () => undefined,
      canUseMasterMode: false,
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
