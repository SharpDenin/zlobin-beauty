import { Navigate, Outlet, Link, useLocation } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'

export function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="state-box">Загрузка…</div>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

export function AppShell() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const isMaster = user?.roles.includes('master') || user?.roles.includes('salon_owner') || user?.roles.includes('system_admin')

  const links = [
    { to: '/', label: 'Главная' },
    { to: '/search', label: 'Поиск' },
    { to: '/appointments', label: 'Записи' },
    ...(isMaster ? [{ to: '/master', label: 'Кабинет' }] : []),
  ]

  return (
    <div className="app-shell">
      <aside className="sidenav">
        <div className="brand">Zlobin Beauty</div>
        <nav className="stack-sm" style={{ marginTop: 24 }}>
          {links.map((l) => (
            <Link key={l.to} to={l.to} className={location.pathname === l.to ? 'active' : ''}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div style={{ marginTop: 'auto' }} className="stack-sm">
          <div className="muted">{user?.display_name}</div>
          <button className="btn btn-secondary" type="button" onClick={() => void logout()}>Выйти</button>
        </div>
      </aside>
      <div>
        <header className="topbar">
          <div className="brand">Zlobin Beauty</div>
          <div className="muted">{user?.display_name}</div>
        </header>
        <Outlet />
      </div>
      <nav className="bottomnav">
        {links.map((l) => (
          <Link key={l.to} to={l.to} className={location.pathname === l.to ? 'active' : ''}>
            {l.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
