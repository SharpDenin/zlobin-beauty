import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import { apiRequest } from '@/shared/api/client'
import { formatMoney } from '@/shared/lib/money'
import { statusBadgeClass, statusLabel } from '@/shared/lib/status'

type Master = {
  id: string
  display_name: string
  city: string
  specializations: string[]
  rating_avg: number
  rating_count: number
}

type Service = {
  id: string
  name: string
  category: string
  duration_minutes: number
  price_minor: number
  price_display?: string
}

type Appointment = {
  id: string
  service_name: string
  status: string
  starts_at: string
  price_minor: number
}

export function HomePage() {
  const { user, accessToken } = useAuth()
  const city = (user?.city?.trim() || 'Москва')

  const masters = useQuery({
    queryKey: ['home-masters', city],
    queryFn: () => apiRequest<{ items: Master[] }>(`/v1/masters?city=${encodeURIComponent(city)}`),
  })

  const services = useQuery({
    queryKey: ['home-services'],
    queryFn: () => apiRequest<{ items: Service[] }>('/v1/services/popular'),
  })

  const appointments = useQuery({
    queryKey: ['home-appointments'],
    queryFn: () => apiRequest<{ items: Appointment[] }>('/v1/appointments/mine?role=client', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const upcoming = (appointments.data?.items ?? [])
    .filter((a) => ['pending_confirmation', 'confirmed', 'in_progress'].includes(a.status))
    .slice(0, 3)

  return (
    <main className="page stack">
      <section className="hero">
        <div className="stack">
          <div className="brand">Zlobin Beauty</div>
          <h1>Здравствуйте, {user?.display_name}</h1>
          <p>
            Город: {city}.
            {!user?.city?.trim() && (
              <> Укажите город в <Link to="/profile">профиле</Link>.</>
            )}
            {' '}Найдите мастера или продолжите запись.
          </p>
          <div className="row">
            <Link className="btn btn-primary" to="/search">Найти мастера</Link>
            <Link className="btn btn-secondary" to="/appointments">Мои записи</Link>
            <Link className="btn btn-secondary" to="/shop">Магазин</Link>
          </div>
        </div>
      </section>

      <section className="stack">
        <div className="row between">
          <h2>Ближайшие записи</h2>
          <Link to="/appointments">Все</Link>
        </div>
        {appointments.isLoading && <div className="state-box">Загрузка записей…</div>}
        {appointments.isError && <div className="state-box error">Не удалось загрузить записи</div>}
        {!appointments.isLoading && upcoming.length === 0 && (
          <div className="state-box">Записей пока нет. <Link to="/search">Выбрать мастера</Link></div>
        )}
        <div className="list">
          {upcoming.map((a) => (
            <Link key={a.id} to={`/appointments/${a.id}`} className="list-item">
              <div className="row between">
                <strong>{a.service_name}</strong>
                <span className={`badge ${statusBadgeClass(a.status)}`}>{statusLabel(a.status)}</span>
              </div>
              <p>{new Date(a.starts_at).toLocaleString('ru-RU')} · {formatMoney(a.price_minor)}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="stack">
        <div className="row between">
          <h2>Рекомендуемые мастера</h2>
          <Link to="/search">Смотреть всех</Link>
        </div>
        {masters.isLoading && <div className="state-box">Загрузка…</div>}
        {masters.isError && <div className="state-box error">Не удалось загрузить мастеров</div>}
        {masters.data && masters.data.items.length === 0 && (
          <div className="state-box">Пока нет опубликованных мастеров в городе {city}</div>
        )}
        <div className="list">
          {masters.data?.items.slice(0, 6).map((m) => (
            <Link key={m.id} to={`/masters/${m.id}`} className="list-item">
              <div className="row between">
                <strong>{m.display_name}</strong>
                <span className="badge badge-default">★ {m.rating_avg.toFixed(1)} ({m.rating_count})</span>
              </div>
              <p>{m.specializations.join(', ') || 'Специализации не указаны'} · {m.city}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="stack">
        <h2>Популярные услуги</h2>
        {services.isLoading && <div className="state-box">Загрузка…</div>}
        {services.isError && <div className="state-box error">Не удалось загрузить услуги</div>}
        {services.data && services.data.items.length === 0 && (
          <div className="state-box">Опубликованных услуг пока нет</div>
        )}
        <div className="list">
          {services.data?.items.map((s) => (
            <article key={s.id} className="list-item">
              <div className="row between">
                <strong>{s.name}</strong>
                <span>{s.price_display || formatMoney(s.price_minor)}</span>
              </div>
              <p>{s.category} · {s.duration_minutes} мин</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
