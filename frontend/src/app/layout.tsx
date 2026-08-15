import { Navigate, Outlet, Link, useLocation } from 'react-router-dom'
import { useMemo, useState, type ReactNode } from 'react'
import { hasMasterAccess, hasSupplierAccess, hasSupplierRepAccess, hasSystemAdmin, useAuth } from '@/features/auth/AuthProvider'

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
  if (!hasMasterAccess(user)) {
    return (
      <main className="page">
        <div className="state-box error">Этот раздел доступен только мастерам и владельцам салона</div>
      </main>
    )
  }
  return <Outlet />
}

export function RequireSupplier() {
  const { user, loading } = useAuth()
  if (loading) return <div className="state-box page">Загрузка…</div>
  if (!hasSupplierAccess(user)) {
    return (
      <main className="page">
        <div className="state-box error">Этот раздел доступен только поставщикам</div>
      </main>
    )
  }
  return <Outlet />
}

type NavLink = { to: string; label: string; end?: boolean }

function masterPrimary(): NavLink[] {
  return [
    { to: '/', label: 'Сегодня', end: true },
    { to: '/calendar', label: 'Календарь' },
    { to: '/appointments', label: 'Записи' },
    { to: '/more', label: 'Ещё' },
  ]
}

function masterSecondary(): NavLink[] {
  return [
    { to: '/clients', label: 'Клиенты' },
    { to: '/services', label: 'Услуги' },
    { to: '/cosmetics', label: 'Косметика' },
    { to: '/knowledge', label: 'База знаний' },
    { to: '/staff', label: 'Команда' },
    { to: '/master', label: 'Кабинет' },
    { to: '/profile', label: 'Профиль' },
  ]
}

function supplierPrimary(): NavLink[] {
  return [
    { to: '/supplier', label: 'Главная', end: true },
    { to: '/supplier/products', label: 'Товары' },
    { to: '/supplier/orders', label: 'Заказы' },
    { to: '/knowledge', label: 'База' },
    { to: '/profile', label: 'Профиль' },
  ]
}

function supplierSecondary(): NavLink[] {
  return [
    { to: '/supplier/analytics', label: 'Аналитика' },
    { to: '/supplier/team', label: 'Представители' },
    { to: '/supplier/recurring', label: 'Регулярные поставки' },
    { to: '/warehouse', label: 'Склад' },
  ]
}

function repPrimary(): NavLink[] {
  return [
    { to: '/rep', label: 'Маршрут', end: true },
    { to: '/calendar', label: 'Календарь' },
    { to: '/profile', label: 'Профиль' },
  ]
}

function clientPrimary(): NavLink[] {
  return [
    { to: '/', label: 'Главная', end: true },
    { to: '/search', label: 'Найти' },
    { to: '/appointments', label: 'Записи' },
    { to: '/profile', label: 'Профиль' },
  ]
}

function linkActive(pathname: string, to: string, end?: boolean) {
  if (to === '/more') return false
  if (end || to === '/') return pathname === to
  if (to === '/supplier/products') return pathname.startsWith('/supplier/products')
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

  const isMaster = hasMasterAccess(user)
  const isSupplier = hasSupplierAccess(user) && !isMaster
  const isRep = hasSupplierRepAccess(user) && !isSupplier && !isMaster

  const primary = useMemo(() => {
    if (isMaster) return masterPrimary()
    if (isSupplier) return supplierPrimary()
    if (isRep) return repPrimary()
    return clientPrimary()
  }, [isMaster, isSupplier, isRep])

  const secondary = useMemo(() => {
    if (isMaster) return masterSecondary()
    if (isSupplier) return supplierSecondary()
    return []
  }, [isMaster, isSupplier])

  const sideLinks = useMemo(() => {
    if (isMaster) {
      return [
        { to: '/', label: 'Сегодня', end: true },
        { to: '/calendar', label: 'Календарь' },
        { to: '/appointments', label: 'Записи' },
        ...masterSecondary(),
      ]
    }
    if (isSupplier) return [...supplierPrimary(), ...supplierSecondary()]
    if (isRep) return repPrimary()
    return clientPrimary()
  }, [isMaster, isSupplier, isRep])

  return (
    <div className="app-shell" style={{ ['--bottom-nav-cols' as string]: String(primary.length) }}>
      <aside className="sidenav">
        <div className="brand">Salon-X</div>
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
          <div className="brand">Salon-X</div>
          <div className="row">
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
