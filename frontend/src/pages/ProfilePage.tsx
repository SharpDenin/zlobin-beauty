import { useAuth } from '@/features/auth/AuthProvider'
import { Link } from 'react-router-dom'

export function ProfilePage() {
  const { user, logout } = useAuth()
  return (
    <main className="page stack">
      <h1>Профиль</h1>
      <section className="card stack">
        <strong>{user?.display_name}</strong>
        <p>{user?.email ?? 'Email не указан'}</p>
        <p>Роли: {user?.roles.join(', ') || '—'}</p>
        <div className="row">
          <Link className="btn btn-secondary" to="/appointments">Мои записи</Link>
          <Link className="btn btn-secondary" to="/notifications">Уведомления</Link>
          <button className="btn btn-danger" type="button" onClick={() => void logout()}>Выйти</button>
        </div>
      </section>
    </main>
  )
}
