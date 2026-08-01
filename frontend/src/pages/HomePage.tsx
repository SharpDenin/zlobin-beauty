import { Link } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'

export function HomePage() {
  const { user } = useAuth()
  return (
    <main className="page stack">
      <section className="hero">
        <div className="stack">
          <div className="brand">Zlobin Beauty</div>
          <h1>Добро пожаловать, {user?.display_name}</h1>
          <p>Найдите мастера, выберите свободное время и запишитесь без звонков.</p>
          <div className="row">
            <Link className="btn btn-primary" to="/search">Найти мастера</Link>
            <Link className="btn btn-secondary" to="/appointments">Мои записи</Link>
          </div>
        </div>
        <div className="card stack-sm">
          <strong>Как это работает</strong>
          <p>1. Поиск по городу</p>
          <p>2. Выбор услуги и слота</p>
          <p>3. Подтверждение мастером</p>
        </div>
      </section>
    </main>
  )
}
