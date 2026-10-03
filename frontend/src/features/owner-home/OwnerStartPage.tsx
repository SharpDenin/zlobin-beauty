import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCabinet } from '@/shared/lib/cabinet'
import { formatMoney } from '@/shared/lib/money'
import { initials } from '@/shared/lib/initials'
import { MediaImage } from '@/shared/ui/MediaImage'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import {
  dayKey,
  formatOwnerDate,
  isDemoAccount,
  ownerManagementTiles,
  pendingConfirmLabel,
  sameCalendarDay,
  shortPersonName,
  weekDays,
} from '@/features/owner-home/owner-home-helpers'
import '@/features/owner-home/owner-home.css'

type OwnerAppointment = {
  id: string
  service_name: string
  status: string
  starts_at: string
  ends_at?: string
  price_minor: number
  client_user_id?: string
  client_display_name?: string
  master_user_id?: string
  master_display_name?: string
  branch_id?: string
}

type MasterHero = {
  display_name?: string
  photo_media_id?: string | null
}

const TILE_PATHS: Record<string, string> = {
  staff: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a5 5 0 0 1 10 0M13 20a5 5 0 0 1 8 0',
  money: 'M4 8h16v10H4zm4 5h8M8 8V6h8v2',
  warehouse: 'M3 20V9l9-5 9 5v11H3zm5-4h8',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13a7.8 7.8 0 0 0 .1-2l2-1.5-2-3.5-2.4.5a8 8 0 0 0-1.7-1L15 3h-6l-.4 2.5a8 8 0 0 0-1.7 1L6.5 6 4.5 9.5 6.5 11a7.8 7.8 0 0 0 0 2l-2 1.5 2 3.5 2.4-.5a8 8 0 0 0 1.7 1L9 21h6l.4-2.5a8 8 0 0 0 1.7-1l2.4.5 2-3.5z',
  clients: 'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-7.5 9a7.5 7.5 0 0 1 15 0',
  services: 'M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6.5 9.5 20 20M6.5 20.5 14 14',
}

function ownerRoleLabel(kind: string): string {
  if (kind === 'salon_owner' || kind === 'chain_owner') return 'Владелец'
  if (kind === 'salon_admin') return 'Администратор'
  return 'Владелец'
}

export function OwnerStartPage() {
  const { user, accessToken } = useAuth()
  const cabinet = useCabinet()
  const [selectedDay, setSelectedDay] = useState(() => new Date())
  const days = useMemo(() => weekDays(new Date()), [])

  const orgID = cabinet.selectedOrg?.organization.id
  const salonName = cabinet.selectedOrg?.organization.name || 'Мой салон'
  const rangeFrom = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    d.setHours(0, 0, 0, 0)
    return d
  }, [])
  const rangeTo = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 14)
    d.setHours(23, 59, 59, 999)
    return d
  }, [])

  const appointments = useQuery({
    queryKey: ['owner-start-appointments', orgID, rangeFrom.toISOString(), rangeTo.toISOString()],
    queryFn: () =>
      apiRequest<{ items: OwnerAppointment[] }>(
        `/v1/calendar/appointments?organization_id=${orgID}&from=${encodeURIComponent(rangeFrom.toISOString())}&to=${encodeURIComponent(rangeTo.toISOString())}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && orgID),
  })

  const masterQ = useQuery({
    queryKey: ['me-master-owner-start'],
    queryFn: async () => {
      try {
        return await apiRequest<{ master: MasterHero }>('/v1/me/master', { token: accessToken })
      } catch {
        return { master: {} as MasterHero }
      }
    },
    enabled: Boolean(accessToken),
    retry: false,
  })

  const items = (appointments.data?.items ?? []).filter((a) => {
    if (cabinet.kind !== 'chain_owner' || !cabinet.selectedBranch?.id) return true
    return !a.branch_id || a.branch_id === cabinet.selectedBranch.id
  })

  const today = new Date()
  const todayItems = items.filter((a) => sameCalendarDay(a.starts_at, today))
  const dayItems = items
    .filter((a) => sameCalendarDay(a.starts_at, selectedDay) && !a.status.startsWith('cancelled'))
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
    .slice(0, 4)
  const pending = items.filter((a) => a.status === 'pending_confirmation')

  const bookedMinutes = todayItems.reduce((sum, a) => {
    if (!a.ends_at) return sum
    return sum + Math.max(0, (new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000)
  }, 0)
  const loadFromAppts = Math.min(100, Math.round((bookedMinutes / (9 * 60)) * 100))
  const revenue = todayItems
    .filter((a) => a.status === 'completed' || a.status === 'in_progress' || a.status === 'confirmed')
    .reduce((sum, a) => sum + (a.price_minor || 0), 0)
  const load = loadFromAppts

  const tiles = ownerManagementTiles((f) => cabinet.can(f))
  const displayName = masterQ.data?.master.display_name?.trim() || user?.display_name || 'Профиль'
  const photo = masterQ.data?.master.photo_media_id
  const demo = isDemoAccount(user?.email)
  const busyDays = useMemo(() => {
    const set = new Set<string>()
    for (const a of items) {
      if (a.status.startsWith('cancelled')) continue
      set.add(dayKey(new Date(a.starts_at)))
    }
    return set
  }, [items])

  return (
    <main className="owner-start" data-testid="owner-start-page">
      <div className="owner-start-bg" aria-hidden="true" />

      <div className="owner-start-panel">
        <header className="owner-start-top">
          <div className="owner-start-brand">
            <p className="owner-start-brand-name">Salon-X</p>
            <p className="owner-start-role">{ownerRoleLabel(cabinet.kind)}</p>
          </div>
          <div className="owner-start-top-right">
            {demo && <span className="owner-start-demo">Демо-данные</span>}
            <Link className="owner-start-avatar" to="/profile" aria-label="Открыть профиль">
              {photo ? (
                <MediaImage mediaId={photo} token={accessToken} alt={displayName} fallback={initials(displayName)} />
              ) : (
                <span aria-hidden="true">{initials(displayName)}</span>
              )}
            </Link>
          </div>
        </header>

        <section className="owner-start-hero">
          <h1>{salonName}</h1>
          <p className="owner-start-date">{formatOwnerDate()}</p>
        </section>

        <section className="owner-start-kpis" aria-label="Показатели дня">
          <div>
            <strong>{formatMoney(revenue)}</strong>
            <span>Выручка</span>
          </div>
          <div>
            <strong>{load}%</strong>
            <span>Загрузка</span>
          </div>
          <div>
            <strong>{todayItems.length}</strong>
            <span>Записей</span>
          </div>
        </section>

        <section className="owner-start-day" aria-label="День салона">
          <div className="owner-start-day-head">
            <h2>День салона</h2>
            <Link to="/appointments">Все записи ›</Link>
          </div>

          <div className="owner-start-strip" role="listbox" aria-label="Дни недели">
            {days.map((d) => {
              const key = dayKey(d)
              const selected = dayKey(selectedDay) === key
              const weekday = d.toLocaleDateString('ru-RU', { weekday: 'short' })
              const hasItems = busyDays.has(key)
              return (
                <button
                  key={key}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`owner-start-chip${selected ? ' is-selected' : ''}${hasItems ? ' has-items' : ''}`}
                  onClick={() => setSelectedDay(d)}
                >
                  <span>{weekday}</span>
                  <strong>{d.getDate()}</strong>
                </button>
              )
            })}
          </div>

          {appointments.isError && <ErrorBanner error={appointments.error} fallbackTitle="Не удалось загрузить записи" />}
          {appointments.isLoading && (
            <div className="stack-sm">
              <div className="skeleton skeleton-card" />
              <div className="skeleton skeleton-card" />
            </div>
          )}

          {!appointments.isLoading && dayItems.length === 0 && (
            <p className="owner-start-empty">На этот день записей нет</p>
          )}

          <ul className="owner-start-appts">
            {dayItems.map((a) => {
              const time = new Date(a.starts_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
              const client = shortPersonName(a.client_display_name) || 'Клиент'
              const master = shortPersonName(a.master_display_name)
              return (
                <li key={a.id}>
                  <Link className="owner-start-appt" to={`/appointments/${a.id}`}>
                    <time dateTime={a.starts_at}>{time}</time>
                    <span className="owner-start-appt-body">
                      <strong>{client}</strong>
                      <span>
                        {a.service_name}
                        {master ? ` · ${master}` : ''}
                      </span>
                    </span>
                    <span className="owner-start-chevron" aria-hidden="true">›</span>
                  </Link>
                </li>
              )
            })}
          </ul>

          {pending.length > 0 && (
            <Link className="owner-start-pending" to="/appointments">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" strokeLinecap="round" />
              </svg>
              {pendingConfirmLabel(pending.length)}
            </Link>
          )}

          <Link className="owner-start-cta" to="/calendar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
            <span>Открыть расписание</span>
            <span className="owner-start-chevron" aria-hidden="true">›</span>
          </Link>
        </section>

        {tiles.length > 0 && (
          <section className="owner-start-manage" aria-label="Управление">
            <h2>Управление</h2>
            <div className="owner-start-tiles">
              {tiles.map((tile) => (
                <Link key={tile.to} className="owner-start-tile" to={tile.to}>
                  <span className="owner-start-chevron" aria-hidden="true">›</span>
                  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d={TILE_PATHS[tile.icon]} />
                  </svg>
                  <span>{tile.label}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
