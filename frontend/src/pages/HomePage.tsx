import { Link, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { hasMasterAccess, hasSupplierAccess, hasSupplierRepAccess, useAuth } from '@/features/auth/AuthProvider'
import { DashboardPage } from '@/pages/DashboardPage'
import { apiRequest } from '@/shared/api/client'
import { formatMoney } from '@/shared/lib/money'
import { statusBadgeClass, statusLabel } from '@/shared/lib/status'

type Appointment = {
  id: string
  service_name: string
  status: string
  starts_at: string
  price_minor: number
}

type Master = {
  id: string
  display_name: string
  city: string
  specializations: string[]
  rating_avg: number
  rating_count: number
}

function ClientHome() {
  const { user, accessToken } = useAuth()
  const city = user?.city?.trim() || 'Москва'

  const appointments = useQuery({
    queryKey: ['home-appointments', 'client'],
    queryFn: () => apiRequest<{ items: Appointment[] }>('/v1/appointments/mine?role=client', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const masters = useQuery({
    queryKey: ['home-masters', city],
    queryFn: () => apiRequest<{ items: Master[] }>(`/v1/masters?city=${encodeURIComponent(city)}`),
  })

  const upcoming = (appointments.data?.items ?? [])
    .filter((a) => ['pending_confirmation', 'confirmed', 'in_progress'].includes(a.status))
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0]

  return (
    <main className="page stack">
      <section className="hero">
        <div className="stack">
          <div className="brand">Salon-X</div>
          <h1>Здравствуйте, {user?.display_name}</h1>
          <p>Запишитесь к мастеру или откройте ближайшую запись.</p>
          <div className="row">
            <Link className="btn btn-primary" to="/search">Найти мастера</Link>
            <Link className="btn btn-secondary" to="/shop">Магазин</Link>
            <Link className="btn btn-secondary" to="/appointments">Мои записи</Link>
          </div>
        </div>
      </section>

      <section className="stack">
        <h2>Ближайшая запись</h2>
        {appointments.isLoading && <div className="state-box">Загрузка…</div>}
        {!appointments.isLoading && !upcoming && (
          <div className="empty-state">
            <h2>Пока нет записей</h2>
            <p>Выберите мастера и удобное время.</p>
            <Link className="btn btn-primary" to="/search">Найти мастера</Link>
          </div>
        )}
        {upcoming && (
          <Link to={`/appointments/${upcoming.id}`} className="list-item">
            <div className="row between">
              <strong>{upcoming.service_name}</strong>
              <span className={`badge ${statusBadgeClass(upcoming.status)}`}>{statusLabel(upcoming.status)}</span>
            </div>
            <p>{new Date(upcoming.starts_at).toLocaleString('ru-RU')} · {formatMoney(upcoming.price_minor)}</p>
          </Link>
        )}
      </section>

      <section className="stack">
        <div className="row between">
          <h2>Мастера рядом</h2>
          <Link to="/search">Все</Link>
        </div>
        <div className="list">
          {masters.data?.items.slice(0, 4).map((m) => (
            <Link key={m.id} to={`/masters/${m.id}`} className="list-item">
              <div className="row between">
                <strong>{m.display_name}</strong>
                <span className="badge badge-default">★ {m.rating_avg.toFixed(1)}</span>
              </div>
              <p>{m.specializations.join(', ') || 'Красота и уход'} · {m.city}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  )
}

function SupplierHomeRedirect() {
  return <Navigate to="/supplier" replace />
}

export function HomePage() {
  const { user } = useAuth()
  if (hasMasterAccess(user)) return <DashboardPage />
  if (hasSupplierAccess(user)) return <SupplierHomeRedirect />
  if (hasSupplierRepAccess(user)) return <Navigate to="/rep" replace />
  return <ClientHome />
}
