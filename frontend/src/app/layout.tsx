import { Navigate, Outlet, Link, useLocation } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { hasMasterAccess, hasSalonAdmin, hasSupplierAccess, hasSupplierRepAccess, hasSystemAdmin, useAuth } from '@/features/auth/AuthProvider'
import { useCabinet, applyNavOrder, moveNavPath, type CabinetFeature, type NavLink } from '@/shared/lib/cabinet'
import { usePreference } from '@/shared/lib/preferences'
import { workTypeLabel } from '@/shared/lib/status'
import { BrandLogo } from '@/shared/ui/BrandLogo'
import { ThemeToggle } from '@/shared/ui/ThemeToggle'
import { Drawer } from '@/shared/ui/Drawer'
import { EmptyState } from '@/shared/ui/EmptyState'
import { NavIcon } from '@/shared/ui/NavIcon'
import { PageLoading } from '@/shared/ui/PageLoading'
import { branchLabel } from '@/shared/lib/branch-label'
import { MessengerProvider, useMessengerOptional } from '@/features/messenger/MessengerProvider'
import { PremiumStatusLink } from '@/features/dashboard/PremiumStatusLink'
import { releaseOrphanedOverlayLock } from '@/shared/ui/overlayLock'

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
          aria-current={linkActive(pathname, l.to, l.end) ? 'page' : undefined}
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
  const { user, logout } = useAuth()
  const cabinet = useCabinet()
  const [navOrder, setNavOrder] = usePreference<string[]>('nav.order', [])
  const [editing, setEditing] = useState(false)
  const ordered = applyNavOrder(links.filter((l) => l.to !== '/more'), navOrder)
  const drag = useRef<{ from: number; y: number } | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)

  useEffect(() => {
    if (!open) setEditing(false)
  }, [open])

  function persistOrder(from: number, to: number) {
    setNavOrder(moveNavPath(ordered.map((l) => l.to), from, to))
  }

  function onHandlePointerDown(index: number, e: ReactPointerEvent<HTMLButtonElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { from: index, y: e.clientY }
    setDragging(index)
    setOver(index)
  }

  function onHandlePointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    if (drag.current == null) return
    const row = e.currentTarget.closest('[data-nav-order-row]')
    const list = row?.parentElement
    if (!list) return
    const rows = Array.from(list.querySelectorAll('[data-nav-order-row]'))
    const y = e.clientY
    let next = drag.current.from
    rows.forEach((el, i) => {
      const box = el.getBoundingClientRect()
      if (y >= box.top && y <= box.bottom) next = i
    })
    setOver(next)
  }

  function onHandlePointerUp() {
    if (drag.current != null && over != null) persistOrder(drag.current.from, over)
    drag.current = null
    setDragging(null)
    setOver(null)
  }

  return (
    <Drawer open={open} onClose={onClose} title="Меню" panelClassName="stack-sm more-menu-panel">
      <section className="stack-sm more-account">
        <p className="more-account-name">{user?.display_name}</p>
        <p className="muted">{cabinet.label}{cabinet.workType ? ` · ${workTypeLabel(cabinet.workType)}` : ''}</p>
        <div className="row wrap gap">
          <Link className="btn btn-secondary btn-compact" to="/profile" onClick={onClose}>Профиль</Link>
          <Link className="btn btn-secondary btn-compact" to="/profile/subscription" onClick={onClose} data-testid="more-premium">
            Premium
          </Link>
          <ThemeToggle labelled />
        </div>
      </section>

      <div className="row between">
        <h2 className="nav-order-title">Навигация</h2>
        <button
          className="btn btn-ghost btn-compact"
          type="button"
          data-testid="menu-edit-order"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? 'Готово' : 'Редактировать порядок'}
        </button>
      </div>

      {editing ? (
        <section className="stack-sm nav-order" data-testid="menu-order-editor">
          <p className="muted">Перетащите за ручку. Порядок сохранится и для нижних вкладок.</p>
          {ordered.map((l, i) => (
            <div
              key={l.to}
              data-nav-order-row
              className={`row between nav-order-row${dragging === i ? ' is-dragging' : ''}${over === i && dragging !== i ? ' is-drop' : ''}`}
            >
              <span className="row gap">
                <NavIcon to={l.to} />
                <span>{l.label}</span>
              </span>
              <button
                className="nav-order-handle"
                type="button"
                aria-label={`Переместить ${l.label}`}
                onPointerDown={(e) => onHandlePointerDown(i, e)}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerUp}
                onPointerCancel={onHandlePointerUp}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75">
                  <path d="M8 7h8M8 12h8M8 17h8" />
                </svg>
              </button>
            </div>
          ))}
        </section>
      ) : (
        <nav className="stack-sm more-nav-list">
          <NavLinks links={ordered} pathname={pathname} onNavigate={onClose} />
        </nav>
      )}

      <div className="stack-sm more-footer">
        <button
          className="btn btn-secondary btn-block"
          type="button"
          onClick={() => {
            onClose()
            void logout()
          }}
        >
          Выйти
        </button>
      </div>
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
  const [desktopNav, setDesktopNav] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : false,
  )
  const cabinet = useCabinet()
  const messenger = useMessengerOptional()

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const sync = () => {
      setDesktopNav(mq.matches)
      if (mq.matches) setMoreOpen(false)
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    releaseOrphanedOverlayLock()
  }, [location.pathname])

  const primary = cabinet.primary
  const secondary = cabinet.secondary
  const sideLinks = cabinet.side

  const orgOptions = useMemo(
    () => cabinet.orgs.filter((o) => o.organization.type !== 'supplier'),
    [cabinet.orgs],
  )

  const fillShell =
    location.pathname.startsWith('/calendar')
    || location.pathname.startsWith('/messages')
    || Boolean(messenger?.overlayOpen)
  const homeRoute = location.pathname === '/'

  return (
    <div
      className={`app-shell${fillShell ? ' app-shell--fill' : ''}${homeRoute ? ' app-shell--home' : ''}`}
      style={{ ['--bottom-nav-cols' as string]: String(primary.length) }}
    >
      <aside className="sidenav">
        <div className="brand"><BrandLogo size="md" /></div>
        <div className="sidenav-toolbar">
          <ThemeToggle labelled />
          <PremiumStatusLink />
        </div>
        <p className="muted cabinet-label">{cabinet.label}</p>
        {cabinet.workType && <p className="muted">{workTypeLabel(cabinet.workType)}</p>}
        {cabinet.kind === 'chain_owner' && orgOptions.length > 1 && (
          <label className="field" style={{ marginTop: 12 }}>
            <span className="muted">Салон</span>
            <select
              className="location-select"
              aria-label="Салон"
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
              className="location-select"
              data-testid="chain-branch-switcher"
              aria-label="Филиал"
              value={cabinet.selectedBranch?.id ?? ''}
              onChange={(e) => cabinet.setSelectedBranchId(e.target.value)}
            >
              {(cabinet.selectedOrg?.branches ?? []).map((b) => (
                <option key={b.id} value={b.id}>{branchLabel(b, cabinet.selectedOrg?.branches ?? [])}</option>
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
        <header className="topbar topbar--compact">
          <div className="topbar-leading">
            <div className="brand"><BrandLogo size="sm" /></div>
          </div>
          <div className="row topbar-actions">
            {cabinet.kind === 'chain_owner' && (cabinet.selectedOrg?.branches.length ?? 0) > 1 && (
              <select
                className="topbar-branch location-select"
                data-testid="chain-branch-switcher"
                aria-label="Филиал"
                value={cabinet.selectedBranch?.id ?? ''}
                onChange={(e) => cabinet.setSelectedBranchId(e.target.value)}
              >
                {(cabinet.selectedOrg?.branches ?? []).map((b) => (
                  <option key={b.id} value={b.id}>{branchLabel(b, cabinet.selectedOrg?.branches ?? [])}</option>
                ))}
              </select>
            )}
            <ThemeToggle />
            <button
              className="btn btn-secondary btn-compact topbar-menu-btn"
              type="button"
              aria-label="Открыть меню"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(true)}
            >
              Меню
            </button>
            {/* Desktop-only chrome kept for wide layouts where topbar is hidden anyway;
                sidenav holds Premium / logout. Compact mobile keeps header short. */}
            <span className="topbar-desktop-only">
              <PremiumStatusLink compact />
              <span className="muted topbar-name">{user?.display_name}</span>
            </span>
            <button
              className="btn btn-secondary btn-compact topbar-logout"
              type="button"
              onClick={() => void logout()}
              aria-label="Выйти"
            >
              Выйти
            </button>
          </div>
        </header>
        <Outlet />
      </div>
      {homeRoute ? null : (
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
      )}
      {!desktopNav && (
        <MoreDrawer
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          links={secondary}
          pathname={location.pathname}
        />
      )}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="row between page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? (typeof subtitle === 'string' ? <p className="muted">{subtitle}</p> : subtitle) : null}
      </div>
      {actions}
    </div>
  )
}
