import { Navigate, Outlet, Link, useLocation } from 'react-router-dom'
import { useMemo, useState, type ReactNode } from 'react'
import { hasMasterAccess, hasSalonAdmin, hasSupplierAccess, hasSupplierRepAccess, hasSystemAdmin, useAuth } from '@/features/auth/AuthProvider'
import { useCabinet, applyNavOrder, type CabinetFeature, type NavLink } from '@/shared/lib/cabinet'
import { usePreference } from '@/shared/lib/preferences'
import { workTypeLabel } from '@/shared/lib/status'
import { BrandLogo } from '@/shared/ui/BrandLogo'
import { ThemeToggle } from '@/shared/ui/ThemeToggle'
import { Drawer } from '@/shared/ui/Drawer'
import { EmptyState } from '@/shared/ui/EmptyState'
import { NavIcon } from '@/shared/ui/NavIcon'
import { PageLoading } from '@/shared/ui/PageLoading'
import { MessengerProvider, useMessengerOptional } from '@/features/messenger/MessengerProvider'

export function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <PageLoading label="Загрузка сессии" />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

function Forbidden({ title, text }: { title: string; text: string }) {
  return (
    <main className="page">
      <EmptyState title={title} text={text} />
    </main>
  )
}

export function RequireAdmin() {
  const { user, loading } = useAuth()
  if (loading) return <PageLoading />
  if (!hasSystemAdmin(user)) {
    return <Forbidden title="Нет доступа" text="Этот раздел доступен только системным администраторам." />
  }
  return <Outlet />
}

export function RequireMaster() {
  const { user, loading } = useAuth()
  if (loading) return <PageLoading />
  if (!hasMasterAccess(user) && !hasSalonAdmin(user)) {
    return <Forbidden title="Нет доступа" text="Этот раздел доступен мастерам, администраторам и владельцам салона." />
  }
  return <Outlet />
}

export function RequireSupplier() {
  const { user, loading } = useAuth()
  if (loading) return <PageLoading />
  if (!hasSupplierAccess(user) && !hasSupplierRepAccess(user)) {
    return <Forbidden title="Нет доступа" text="Этот раздел доступен только поставщикам." />
  }
  return <Outlet />
}

export function RequireCabinetFeature({ feature }: { feature: CabinetFeature }) {
  const cabinet = useCabinet()
  if (!cabinet.ready) return <PageLoading />
  if (!cabinet.can(feature)) {
    return <Forbidden title="Нет доступа" text="Этот раздел недоступен для вашей роли." />
  }
  return <Outlet />
}

function linkActive(pathname: string, to: string, end?: boolean) {
  if (to === '/more') return false
  if (end || to === '/') return pathname === to
  if (to === '/supplier/products') return pathname.startsWith('/supplier/products')
  if (to === '/rep') return pathname === '/rep'
  return pathname === to || pathname.startsWith(`${to}/`)
}

function NavLinks({
  links,
  pathname,
  onNavigate,
  className,
}: {
  links: NavLink[]
  pathname: string
  onNavigate?: () => void
  className?: string
}) {
  const messenger = useMessengerOptional()
  return (
    <>
      {links.map((l) => {
        const messagesActive = l.to === '/messages' && Boolean(messenger?.overlayOpen)
        return (
        <Link
          key={l.to}
          to={l.to === '/more' ? '#' : l.to}
          className={`${className ?? ''} ${linkActive(pathname, l.to, l.end) || messagesActive ? 'active' : ''}`.trim()}
          aria-current={linkActive(pathname, l.to, l.end) || messagesActive ? 'page' : undefined}
          onClick={(e) => {
            if (l.to === '/more') {
              e.preventDefault()
              onNavigate?.()
              return
            }
            if (l.to === '/messages' && messenger?.isDesktop) {
              e.preventDefault()
              messenger.openList()
              onNavigate?.()
              return
            }
            onNavigate?.()
          }}
        >
          <NavIcon to={l.to} />
          <span>{l.label}</span>
          {l.to === '/messages' && (messenger?.unreadTotal ?? 0) > 0 && (
            <span className="nav-unread" aria-label={`${messenger!.unreadTotal} непрочитанных`}>
              {messenger!.unreadTotal > 99 ? '99+' : messenger!.unreadTotal}
            </span>
          )}
        </Link>
        )
      })}
    </>
  )
}

function MoreDrawer({
  open,
  onClose,
  links,
  pathname,
}: {
  open: boolean
  onClose: () => void
  links: NavLink[]
  pathname: string
}) {
  const cabinet = useCabinet()
  const [navOrder, setNavOrder] = usePreference<string[]>('nav.order', [])
  const primary = applyNavOrder(cabinet.primary, navOrder).filter((l) => l.to !== '/more')
  function move(index: number, dir: -1 | 1) {
    const next = primary.map((l) => l.to)
    const j = index + dir
    if (j < 0 || j >= next.length) return
    ;[next[index], next[j]] = [next[j], next[index]]
    setNavOrder(next)
  }
  return (
    <Drawer open={open} onClose={onClose} title="Ещё" panelClassName="stack-sm">
      <NavLinks links={links} pathname={pathname} onNavigate={onClose} />
      {primary.length > 1 && (
        <section className="stack-sm nav-order">
          <h2 className="nav-order-title">Порядок вкладок</h2>
          <p className="muted">Сохраняется для вашего аккаунта. На мобильном меняет нижнее меню.</p>
          {primary.map((l, i) => (
            <div key={l.to} className="row between nav-order-row">
              <span>{l.label}</span>
              <div className="row">
                <button className="btn btn-secondary btn-compact" type="button" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button className="btn btn-secondary btn-compact" type="button" disabled={i === primary.length - 1} onClick={() => move(i, 1)}>↓</button>
              </div>
            </div>
          ))}
        </section>
      )}
    </Drawer>
  )
}

export function AppShell() {
  return (
    <MessengerProvider>
      <AppShellInner />
    </MessengerProvider>
  )
}

function AppShellInner() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const cabinet = useCabinet()

  const primary = cabinet.primary
  const secondary = cabinet.secondary
  const sideLinks = cabinet.side

  const orgOptions = useMemo(
    () => cabinet.orgs.filter((o) => o.organization.type !== 'supplier'),
    [cabinet.orgs],
  )

  return (
    <div className="app-shell" style={{ ['--bottom-nav-cols' as string]: String(primary.length) }}>
      <aside className="sidenav">
        <div className="brand"><BrandLogo size="md" /></div>
        <ThemeToggle labelled />
        <p className="muted cabinet-label">{cabinet.label}</p>
        {cabinet.workType && <p className="muted">{workTypeLabel(cabinet.workType)}</p>}
        {cabinet.kind === 'chain_owner' && orgOptions.length > 1 && (
          <label className="field" style={{ marginTop: 12 }}>
            <span className="muted">Салон</span>
            <select
              value={cabinet.selectedOrg?.organization.id ?? ''}
              onChange={(e) => cabinet.setSelectedOrgId(e.target.value)}
            >
              {orgOptions.map((o) => (
                <option key={o.organization.id} value={o.organization.id}>{o.organization.name}</option>
              ))}
            </select>
          </label>
        )}
        {cabinet.kind === 'chain_owner' && (cabinet.selectedOrg?.branches.length ?? 0) > 1 && (
          <label className="field" style={{ marginTop: 12 }}>
            <span className="muted">Филиал</span>
            <select
              data-testid="chain-branch-switcher"
              value={cabinet.selectedBranch?.id ?? ''}
              onChange={(e) => cabinet.setSelectedBranchId(e.target.value)}
            >
              {(cabinet.selectedOrg?.branches ?? []).map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
        )}
        <nav className="stack-sm" style={{ marginTop: 24 }}>
          <NavLinks links={sideLinks} pathname={location.pathname} />
        </nav>
        <div style={{ marginTop: 'auto' }} className="stack-sm">
          <div className="muted">{user?.display_name}</div>
          <button className="btn btn-secondary" type="button" onClick={() => void logout()}>Выйти</button>
        </div>
      </aside>
      <div className="shell-main">
        <header className="topbar">
          <div>
            <div className="brand"><BrandLogo size="sm" /></div>
            <div className="muted topbar-cabinet">{cabinet.label}</div>
          </div>
          <div className="row">
            {cabinet.kind === 'chain_owner' && (cabinet.selectedOrg?.branches.length ?? 0) > 1 && (
              <select
                className="topbar-branch"
                data-testid="chain-branch-switcher"
                aria-label="Филиал"
                value={cabinet.selectedBranch?.id ?? ''}
                onChange={(e) => cabinet.setSelectedBranchId(e.target.value)}
              >
                {(cabinet.selectedOrg?.branches ?? []).map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            )}
            <ThemeToggle />
            <span className="muted topbar-name">{user?.display_name}</span>
            <button className="btn btn-secondary btn-compact" type="button" onClick={() => void logout()}>
              Выйти
            </button>
          </div>
        </header>
        <Outlet />
      </div>
      <nav className="bottomnav" aria-label="Основная навигация">
        {primary.map((l) => {
          if (l.to === '/more') {
            return (
              <button
                key={l.to}
                type="button"
                className={`nav-tab ${moreOpen ? 'active' : ''}`}
                aria-expanded={moreOpen}
                aria-haspopup="dialog"
                onClick={() => setMoreOpen(true)}
              >
                <NavIcon to="/more" />
                <span>{l.label}</span>
              </button>
            )
          }
          return (
            <Link
              key={l.to}
              to={l.to}
              className={linkActive(location.pathname, l.to, l.end) ? 'active' : ''}
              aria-current={linkActive(location.pathname, l.to, l.end) ? 'page' : undefined}
            >
              <NavIcon to={l.to} />
              <span>{l.label}</span>
            </Link>
          )
        })}
      </nav>
      <MoreDrawer
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        links={secondary}
        pathname={location.pathname}
      />
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="page-toolbar">
      <div className="stack-sm">
        <h1>{title}</h1>
        {subtitle}
      </div>
      {actions}
    </div>
  )
}
