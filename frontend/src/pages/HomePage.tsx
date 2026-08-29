import { Link, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { hasMasterAccess, hasSalonAdmin, hasSupplierAccess, hasSupplierRepAccess, useAuth } from '@/features/auth/AuthProvider'
import { DashboardPage } from '@/pages/DashboardPage'
import { apiRequest } from '@/shared/api/client'
import { masterProfessionLabel } from '@/shared/lib/profession-types'
import { initials } from '@/shared/lib/initials'
import { AppointmentCard } from '@/shared/ui/AppointmentCard'
import { EmptyState } from '@/shared/ui/EmptyState'
import { BrandLogo } from '@/shared/ui/BrandLogo'

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
  profession_types?: { id: string; slug: string; name: string }[]
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
          <BrandLogo size="md" />
          <h1>{user?.display_name}</h1>
          <p>Запись к мастеру за пару шагов.</p>
          <div className="row">
            <Link className="btn btn-primary" to="/search">Найти мастера</Link>
            <Link className="btn btn-secondary" to="/appointments">Записи</Link>
          </div>
        </div>
      </section>

      <section className="stack">
        <h2>Ближайшая запись</h2>
        {appointments.isLoading && <div className="skeleton skeleton-card" />}
        {!appointments.isLoading && !upcoming && (
          <EmptyState
            title="Пока нет записей"
            text="Выберите мастера и удобное время."
            action={<Link className="btn btn-primary" to="/search">Найти мастера</Link>}
          />
        )}
        {upcoming && (
          <AppointmentCard
            to={`/appointments/${upcoming.id}`}
            serviceName={upcoming.service_name}
            status={upcoming.status}
            startsAt={upcoming.starts_at}
            priceMinor={upcoming.price_minor}
          />
        )}
      </section>

      <section className="stack">
        <div className="row between">
          <h2>Мастера рядом</h2>
          <Link className="btn-link" to="/search">Все</Link>
        </div>
        <div className="list">
          {masters.isLoading && <div className="skeleton skeleton-card" />}
          {masters.data?.items.slice(0, 4).map((m) => (
            <Link key={m.id} to={`/masters/${m.id}`} className="list-item home-master-card">
              <div className="avatar-circle">{initials(m.display_name)}</div>
              <div className="stack-sm">
                <strong>{m.display_name}</strong>
                <span className="meta">{masterProfessionLabel(m, 'Красота и уход')} · {m.city}</span>
              </div>
              <span className="badge badge-default">{m.rating_avg.toFixed(1)}</span>
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
  if (hasMasterAccess(user) || hasSalonAdmin(user)) return <DashboardPage />
  if (hasSupplierAccess(user)) return <SupplierHomeRedirect />
  if (hasSupplierRepAccess(user)) return <Navigate to="/rep" replace />
  return <ClientHome />
}
