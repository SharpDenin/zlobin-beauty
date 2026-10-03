import { Link, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { hasMasterAccess, hasSalonAdmin, hasSupplierAccess, hasSupplierRepAccess, useAuth } from '@/features/auth/AuthProvider'
import { useCabinet } from '@/shared/lib/cabinet'
import { isOwnerStartKind } from '@/features/owner-home/owner-home-helpers'
import { OwnerStartPage } from '@/features/owner-home/OwnerStartPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { apiRequest } from '@/shared/api/client'
import { masterProfessionLabel } from '@/shared/lib/profession-types'
import { AppointmentCard } from '@/shared/ui/AppointmentCard'
import { EmptyState } from '@/shared/ui/EmptyState'
import { BrandLogo } from '@/shared/ui/BrandLogo'
import { ServiceCardMedia } from '@/shared/ui/ServiceCardMedia'
import { groupAppointmentsByVisit, visitGroupTitle } from '@/pages/visit-plan-helpers'
import '@/features/media-cards/media-cards.css'

type Appointment = {
  id: string
  service_name: string
  status: string
  starts_at: string
  price_minor: number
  master_display_name?: string
  visit_group_id?: string | null
}

type Master = {
  id: string
  display_name: string
  city: string
  specializations: string[]
  profession_types?: { id: string; slug: string; name: string }[]
  rating_avg: number
  rating_count: number
  photo_media_id?: string | null
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

  const upcoming = groupAppointmentsByVisit(
    (appointments.data?.items ?? []).filter((a) =>
      ['pending_confirmation', 'confirmed', 'in_progress'].includes(a.status),
    ),
  ).sort((a, b) => a.items[0].starts_at.localeCompare(b.items[0].starts_at))[0]

  return (
    <main className="page stack client-home">
      <section className="hero client-home-hero">
        <div className="stack">
          <BrandLogo size="md" />
          <h1 className="display">{user?.display_name || 'Салон'}</h1>
          <p>Запись к мастеру за пару шагов — выберите специалиста, услугу и удобное время.</p>
          <div className="row">
            <Link className="btn btn-primary" to="/search">Найти мастера</Link>
            <Link className="btn btn-secondary" to="/appointments">Мои записи</Link>
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
            to={`/appointments/${upcoming.items[0].id}`}
            serviceName={visitGroupTitle(upcoming)}
            personName={upcoming.items[0].master_display_name}
            subtitle={upcoming.combined ? 'Визит из двух услуг' : undefined}
            status={upcoming.items[0].status}
            startsAt={upcoming.items[0].starts_at}
            priceMinor={upcoming.items.reduce((n, item) => n + item.price_minor, 0)}
          />
        )}
      </section>

      <section className="stack">
        <div className="row between">
          <h2>Мастера рядом</h2>
          <Link className="btn-link" to="/search">Все ›</Link>
        </div>
        <div className="list">
          {masters.isLoading && <div className="skeleton skeleton-card" />}
          {masters.data?.items.slice(0, 4).map((m) => (
            <Link key={m.id} to={`/masters/${m.id}`} className="list-item home-master-card media-first-card card-interactive">
              <ServiceCardMedia
                mediaId={m.photo_media_id}
                name={m.display_name}
                token={accessToken}
                aspect="hero"
                overlay={{
                  title: m.display_name,
                  meta: `${masterProfessionLabel(m, 'Красота и уход')} · ${m.city}`,
                }}
              />
              <div className="media-first-body row between">
                <span className="meta">★ {m.rating_avg.toFixed(1)} ({m.rating_count})</span>
                <span className="badge badge-default">{m.city}</span>
              </div>
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
  const cabinet = useCabinet()
  if (hasSupplierAccess(user)) return <SupplierHomeRedirect />
  if (hasSupplierRepAccess(user)) return <Navigate to="/rep" replace />
  if (isOwnerStartKind(cabinet.kind)) return <OwnerStartPage />
  if (hasMasterAccess(user) || hasSalonAdmin(user)) return <DashboardPage />
  return <ClientHome />
}
