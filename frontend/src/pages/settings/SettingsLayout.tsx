import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'

const SECTIONS = [
  { to: '/settings/appearance', label: 'Оформление', end: false },
  { to: '/settings/notifications', label: 'Уведомления', end: false },
  { to: '/settings/salons', label: 'Мои салоны', end: false },
  { to: '/settings/account', label: 'Аккаунт', end: false },
] as const

export function SettingsLayout() {
  const location = useLocation()
  if (location.pathname === '/settings' || location.pathname === '/settings/') {
    return <Navigate to="/settings/appearance" replace />
  }

  return (
    <main className="page stack settings-page" data-testid="settings-page">
      <header className="stack-sm">
        <h1>Настройки</h1>
        <p className="muted">Оформление, push-уведомления, салоны и удаление аккаунта. Профиль мастера — в разделе «Профиль».</p>
      </header>
      <nav className="settings-nav row wrap gap" aria-label="Разделы настроек">
        {SECTIONS.map((s) => (
          <NavLink
            key={s.to}
            to={s.to}
            className={({ isActive }) => `btn btn-compact ${isActive ? 'btn-primary' : 'btn-secondary'}`}
            end={s.end}
          >
            {s.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </main>
  )
}
