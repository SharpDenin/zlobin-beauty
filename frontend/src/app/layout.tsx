import { Navigate, Outlet, Link, useLocation } from 'react-router-dom'
import { hasMasterAccess, hasSupplierAccess, hasSystemAdmin, useAuth } from '@/features/auth/AuthProvider'

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

type NavLink = { to: string; label: string }

function navLinksForUser(user: ReturnType<typeof useAuth>['user']): NavLink[] {
  const isMaster = hasMasterAccess(user)
  const isSupplier = hasSupplierAccess(user)

  if (isMaster) {
    return [
      { to: '/appointments', label: 'Записи' },
      { to: '/calendar', label: 'Календарь' },
      { to: '/clients', label: 'Клиенты' },
      { to: '/cosmetics', label: 'Косметика' },
      { to: '/knowledge', label: 'База знаний' },
      { to: '/master', label: 'Кабинет' },
      { to: '/profile', label: 'Профиль' },
    ]
  }

  if (isSupplier) {
    return [
      { to: '/supplier', label: 'Товары' },
      { to: '/knowledge', label: 'База знаний' },
      { to: '/profile', label: 'Профиль' },
    ]
  }

  return [
    { to: '/', label: 'Главная' },
    { to: '/search', label: 'Поиск' },
    { to: '/appointments', label: 'Мои записи' },
    { to: '/profile', label: 'Профиль' },
  ]
}

export function AppShell() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const links = navLinksForUser(user)

  function linkActive(to: string) {
    if (to === '/') return location.pathname === '/'
    return location.pathname === to || location.pathname.startsWith(`${to}/`)
  }

  return (
    <div className="app-shell" style={{ ['--bottom-nav-cols' as string]: String(links.length) }}>
      <aside className="sidenav">
        <div className="brand">Zlobin Beauty</div>
        <nav className="stack-sm" style={{ marginTop: 24 }}>
          {links.map((l) => (
            <Link key={l.to} to={l.to} className={linkActive(l.to) ? 'active' : ''}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div style={{ marginTop: 'auto' }} className="stack-sm">
          <div className="muted">{user?.display_name}</div>
          <Link to="/profile" className={linkActive('/profile') ? 'active' : ''}>Профиль</Link>
          <button className="btn btn-secondary" type="button" onClick={() => void logout()}>Выйти</button>
        </div>
      </aside>
      <div className="shell-main">
        <header className="topbar">
          <div className="brand">Zlobin Beauty</div>
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
        {links.map((l) => (
          <Link key={l.to} to={l.to} className={linkActive(l.to) ? 'active' : ''}>
            {l.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
