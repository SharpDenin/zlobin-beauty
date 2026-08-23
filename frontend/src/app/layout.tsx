import { Navigate, Outlet, Link, useLocation } from 'react-router-dom'
import { useMemo, useState, type ReactNode } from 'react'
import { hasMasterAccess, hasSalonAdmin, hasSupplierAccess, hasSupplierRepAccess, hasSystemAdmin, useAuth } from '@/features/auth/AuthProvider'
import { useCabinet, type CabinetFeature, type NavLink } from '@/shared/lib/cabinet'
import { workTypeLabel } from '@/shared/lib/status'
import { BrandLogo } from '@/shared/ui/BrandLogo'

export function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="state-box page">Загрузка…</div>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

export function RequireAdmin() {
  const { user, loading } = useAuth()
  if (loading) return <div className="state-box page">Загрузка…</div>
  if (!hasSystemAdmin(user)) {
    return (
      <main className="page">
        <div className="state-box error">Раздел доступен только системным администраторам</div>
      </main>
    )
  }
  return <Outlet />
}

export function RequireMaster() {
  const { user, loading } = useAuth()
  if (loading) return <div className="state-box page">Загрузка…</div>
  if (!hasMasterAccess(user) && !hasSalonAdmin(user)) {
    return (
      <main className="page">
        <div className="state-box error">Этот раздел доступен мастерам, администраторам и владельцам салона</div>
      </main>
    )
  }
  return <Outlet />
}

export function RequireSupplier() {
  const { user, loading } = useAuth()
  if (loading) return <div className="state-box page">Загрузка…</div>
  if (!hasSupplierAccess(user) && !hasSupplierRepAccess(user)) {
    return (
      <main className="page">
        <div className="state-box error">Этот раздел доступен только поставщикам</div>
      </main>
    )
  }
  return <Outlet />
}

export function RequireCabinetFeature({ feature }: { feature: CabinetFeature }) {
  const cabinet = useCabinet()
  if (!cabinet.ready) return <div className="state-box page">Загрузка…</div>
  if (!cabinet.can(feature)) {
    return (
      <main className="page">
        <div className="state-box error">Этот раздел недоступен для вашей роли</div>
      </main>
    )
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
  return (
    <>
      {links.map((l) => (
        <Link
          key={l.to}
          to={l.to === '/more' ? '#' : l.to}
          className={`${className ?? ''} ${linkActive(pathname, l.to, l.end) ? 'active' : ''}`.trim()}
          onClick={(e) => {
            if (l.to === '/more') {
              e.preventDefault()
              onNavigate?.()
              return
            }
            onNavigate?.()
          }}
        >
          {l.label}
        </Link>
      ))}
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
  if (!open) return null
  return (
    <div className="more-drawer" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="more-panel stack-sm" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>Ещё</h2>
          <button className="btn btn-secondary btn-compact" type="button" onClick={onClose}>Закрыть</button>
        </div>
        <NavLinks links={links} pathname={pathname} onNavigate={onClose} />
      </div>
    </div>
  )
}

export function AppShell() {
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
                onClick={() => setMoreOpen(true)}
              >
                {l.label}
              </button>
            )
          }
          return (
            <Link
              key={l.to}
              to={l.to}
              className={linkActive(location.pathname, l.to, l.end) ? 'active' : ''}
            >
              {l.label}
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
    <div className="row between">
      <div className="stack-sm">
        <h1>{title}</h1>
        {subtitle}
      </div>
      {actions}
    </div>
  )
}
