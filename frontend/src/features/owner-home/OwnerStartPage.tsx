import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCabinet } from '@/shared/lib/cabinet'
import { formatMoney } from '@/shared/lib/money'
import { initials } from '@/shared/lib/initials'
import { branchLabel } from '@/shared/lib/branch-label'
import { uploadMedia } from '@/shared/lib/mediaUpload'
import { MediaImage } from '@/shared/ui/MediaImage'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { toast } from '@/shared/ui/Toast'
import { userError } from '@/shared/lib/app-error'
import { HOME_BACKGROUNDS, setHomeBackground, useHomeBackground } from '@/shared/theme/backgrounds'
import { useMessengerOptional } from '@/features/messenger/MessengerProvider'
import { enableDevicePush } from '@/features/pwa/push'
import {
  dayKey,
  formatOwnerDate,
  homeAudience,
  homeShowsSchedule,
  homeTiles,
  isDemoAccount,
  pendingConfirmLabel,
  sameCalendarDay,
  scheduleHeading,
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
  client_display_name?: string
  master_display_name?: string
  branch_id?: string
}

type MasterHero = {
  id?: string
  display_name?: string
  bio?: string
  city?: string
  organization_id?: string | null
  branch_id?: string | null
  specializations?: string[]
  experience_years?: number
  education?: string
  photo_media_id?: string | null
  work_type?: string
  work_types?: string[]
  published?: boolean
  profession_types?: { id: string }[]
}

type NotificationItem = {
  id: string
  title: string
  body: string
  read_at: string | null
  created_at: string
  entity_type?: string
  entity_id?: string | null
}

const TILE_PATHS: Record<string, string> = {
  staff: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a5 5 0 0 1 10 0M13 20a5 5 0 0 1 8 0',
  money: 'M4 8h16v10H4zm4 5h8M8 8V6h8v2',
  warehouse: 'M3 20V9l9-5 9 5v11H3zm5-4h8',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13a7.8 7.8 0 0 0 .1-2l2-1.5-2-3.5-2.4.5a8 8 0 0 0-1.7-1L15 3h-6l-.4 2.5a8 8 0 0 0-1.7 1L6.5 6 4.5 9.5 6.5 11a7.8 7.8 0 0 0 0 2l-2 1.5 2 3.5 2.4-.5a8 8 0 0 0 1.7 1L9 21h6l.4-2.5a8 8 0 0 0 1.7-1l2.4.5 2-3.5z',
  clients: 'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-7.5 9a7.5 7.5 0 0 1 15 0',
  services: 'M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6.5 9.5 20 20M6.5 20.5 14 14',
}

function ClientMasters({ city }: { city?: string | null }) {
  const place = city?.trim() || 'Москва'
  const masters = useQuery({
    queryKey: ['home-masters', place],
    queryFn: () => apiRequest<{ items: Array<{ id: string; display_name: string; city: string; rating_avg: number }> }>(
      `/v1/masters?city=${encodeURIComponent(place)}`,
    ),
  })
  const items = masters.data?.items?.slice(0, 4) ?? []
  if (!masters.isLoading && items.length === 0) return null
  return (
    <section className="owner-start-notes" aria-label="Мастера рядом">
      <div className="owner-start-day-head">
        <h2>Мастера рядом</h2>
        <Link to="/search">Все ›</Link>
      </div>
      <ul className="owner-start-note-list">
        {items.map((m) => (
          <li key={m.id}>
            <Link className="owner-start-note" to={`/masters/${m.id}`}>
              <strong>{m.display_name}</strong>
              <span>{m.city} · ★ {(m.rating_avg ?? 0).toFixed(1)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ownerRoleLabel(kind: string, fallback: string): string {
  if (kind === 'salon_owner' || kind === 'chain_owner') return 'Владелец'
  if (kind === 'salon_admin') return 'Администратор'
  return fallback || 'Salon-X'
}

function notificationHref(n: NotificationItem) {
  if (n.entity_type === 'appointment' && n.entity_id) return `/appointments/${n.entity_id}`
  if (n.entity_type === 'conversation' && n.entity_id) return `/messages/${n.entity_id}`
  if (n.entity_type === 'masterclass' && n.entity_id) return `/masterclasses/${n.entity_id}`
  if (n.entity_type === 'model_request' && n.entity_id) return `/models/${n.entity_id}`
  if (n.entity_type === 'client_order' && n.entity_id) return `/orders/${n.entity_id}`
  return '/notifications'
}

export function OwnerStartPage() {
  const { user, accessToken } = useAuth()
  const cabinet = useCabinet()
  const background = useHomeBackground()
  const messenger = useMessengerOptional()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [selectedDay, setSelectedDay] = useState(() => new Date())
  const [bgOpen, setBgOpen] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const days = useMemo(() => weekDays(new Date()), [])
  const audience = homeAudience(cabinet.kind)
  const showSchedule = homeShowsSchedule(cabinet.kind)

  const orgID = cabinet.selectedOrg?.organization.id
  const salonName = cabinet.selectedOrg?.organization.name || user?.display_name || 'Мой салон'
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
    queryKey: ['owner-start-appointments', audience, orgID, rangeFrom.toISOString(), rangeTo.toISOString()],
    queryFn: () => {
      if (audience === 'salon') {
        return apiRequest<{ items: OwnerAppointment[] }>(
          `/v1/calendar/appointments?organization_id=${orgID}&from=${encodeURIComponent(rangeFrom.toISOString())}&to=${encodeURIComponent(rangeTo.toISOString())}`,
          { token: accessToken },
        )
      }
      const role = audience === 'client' ? 'client' : 'master'
      return apiRequest<{ items: OwnerAppointment[] }>(`/v1/appointments/mine?role=${role}`, { token: accessToken })
    },
    enabled: Boolean(accessToken && showSchedule && (audience !== 'salon' || orgID)),
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
    enabled: Boolean(accessToken && (audience === 'salon' || audience === 'master')),
    retry: false,
  })

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiRequest<{ items: NotificationItem[] }>('/v1/notifications', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const pushConfig = useQuery({
    queryKey: ['push-config'],
    queryFn: () => apiRequest<{ enabled: boolean; public_key: string }>('/v1/push/config', { token: accessToken }),
    enabled: Boolean(accessToken),
    retry: false,
  })

  const items = (appointments.data?.items ?? []).filter((a) => {
    if (cabinet.kind !== 'chain_owner' || !cabinet.selectedBranch?.id) return true
    return !a.branch_id || a.branch_id === cabinet.selectedBranch.id
  })

  const today = new Date()
  const todayItems = items.filter((a) => sameCalendarDay(a.starts_at, today) && !a.status.startsWith('cancelled'))
  const dayItems = items
    .filter((a) => sameCalendarDay(a.starts_at, selectedDay) && !a.status.startsWith('cancelled'))
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
    .slice(0, 4)
  const pending = items.filter((a) => a.status === 'pending_confirmation')
  const nextAppt = [...items]
    .filter((a) => !a.status.startsWith('cancelled') && new Date(a.starts_at).getTime() >= today.getTime() - 60 * 60 * 1000)
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0]

  const bookedMinutes = todayItems.reduce((sum, a) => {
    if (!a.ends_at) return sum
    return sum + Math.max(0, (new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000)
  }, 0)
  const loadFromAppts = Math.min(100, Math.round((bookedMinutes / (9 * 60)) * 100))
  const revenue = todayItems
    .filter((a) => a.status === 'completed' || a.status === 'in_progress' || a.status === 'confirmed')
    .reduce((sum, a) => sum + (a.price_minor || 0), 0)

  const tiles = homeTiles(cabinet.kind, (f) => cabinet.can(f))
  const master = masterQ.data?.master
  const displayName = master?.display_name?.trim() || user?.display_name || 'Профиль'
  const photo = master?.photo_media_id
  const canEditPhoto = Boolean(master?.id || master?.display_name)
  const demo = isDemoAccount(user?.email)
  const notes = notifications.data?.items ?? []
  const unread = notes.filter((n) => !n.read_at)
  const branches = cabinet.selectedOrg?.branches ?? []
  const busyDays = useMemo(() => {
    const set = new Set<string>()
    for (const a of items) {
      if (a.status.startsWith('cancelled')) continue
      set.add(dayKey(new Date(a.starts_at)))
    }
    return set
  }, [items])

  const title = audience === 'salon'
    ? salonName
    : audience === 'supplier'
      ? (cabinet.selectedOrg?.organization.name || 'Поставки')
      : audience === 'rep'
        ? 'Смена'
        : audience === 'admin'
          ? 'Платформа'
          : audience === 'client'
            ? (user?.display_name || 'Главная')
            : displayName

  async function onPhoto(file: File | undefined) {
    if (!file || !accessToken || !master) return
    setPhotoBusy(true)
    try {
      const uploaded = await uploadMedia(file, 'profile', accessToken)
      await apiRequest('/v1/me/master', {
        method: 'PUT',
        token: accessToken,
        body: {
          organization_id: master.organization_id ?? '',
          branch_id: master.branch_id ?? '',
          display_name: master.display_name || user?.display_name || '',
          bio: master.bio ?? '',
          specializations: master.specializations ?? [],
          city: master.city || user?.city || '',
          experience_years: master.experience_years ?? 0,
          education: master.education ?? '',
          photo_media_id: uploaded.id,
          work_type: master.work_type ?? '',
          work_types: master.work_types ?? [],
          published: Boolean(master.published),
        },
      })
      await qc.invalidateQueries({ queryKey: ['me-master-owner-start'] })
      await qc.invalidateQueries({ queryKey: ['me-master-cabinet'] })
      toast.success('Фото профиля обновлено')
    } catch (e) {
      toast.error(userError(e, 'Не удалось обновить фото'))
    } finally {
      setPhotoBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <main
      className="owner-start"
      data-testid="owner-start-page"
      style={{ ['--owner-bg-image' as string]: `url('${background.src}')` }}
    >
      <div className="owner-start-bg" aria-hidden="true" />

      <div className="owner-start-panel">
        <header className="owner-start-top">
          <div className="owner-start-brand">
            <p className="owner-start-brand-name">Salon-X</p>
            <p className="owner-start-role">{ownerRoleLabel(cabinet.kind, cabinet.label)}</p>
          </div>
          <div className="owner-start-top-right">
            {demo && <span className="owner-start-demo">Демо-данные</span>}
            <button
              className="owner-start-icon-btn"
              type="button"
              aria-label="Открыть сообщения"
              aria-expanded={messenger?.overlayOpen || undefined}
              onClick={() => messenger?.openList()}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <path d="M5 6.5h14v9.2a1.8 1.8 0 0 1-1.8 1.8H9l-4 2.8v-2.8H5.8A1.8 1.8 0 0 1 4 15.7V6.5Z" strokeLinejoin="round" />
              </svg>
              {(messenger?.unreadTotal ?? 0) > 0 && (
                <span className="owner-start-badge">{messenger!.unreadTotal > 9 ? '9+' : messenger!.unreadTotal}</span>
              )}
            </button>
            <div className="owner-start-bg-anchor">
              <button
                className="owner-start-icon-btn"
                type="button"
                aria-label="Выбрать фон"
                aria-expanded={bgOpen}
                onClick={() => setBgOpen((v) => !v)}
              >
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <rect x="4" y="5" width="16" height="14" rx="2" />
                  <path d="m8 15 2.5-3 2 2.2L15 11l3 4" strokeLinejoin="round" />
                </svg>
              </button>
              {bgOpen && (
                <div className="owner-start-bg-pop" role="dialog" aria-label="Фон главной">
                  <p>Фон главной</p>
                  <div className="owner-start-bg-grid">
                    {HOME_BACKGROUNDS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`owner-start-bg-option${item.id === background.id ? ' is-selected' : ''}`}
                        aria-pressed={item.id === background.id}
                        onClick={() => {
                          setHomeBackground(item.id)
                          setBgOpen(false)
                        }}
                      >
                        <img src={item.src} alt="" />
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="owner-start-avatar-wrap">
              <Link className="owner-start-avatar" to="/profile" aria-label="Открыть профиль">
                {photo ? (
                  <MediaImage mediaId={photo} token={accessToken} alt={displayName} fallback={initials(displayName)} />
                ) : (
                  <span aria-hidden="true">{initials(displayName)}</span>
                )}
              </Link>
              {canEditPhoto && (
                <label className="owner-start-avatar-edit">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => void onPhoto(e.target.files?.[0])}
                  />
                  {photoBusy ? 'Сохраняем…' : 'Изменить фото'}
                </label>
              )}
            </div>
          </div>
        </header>

        <section className="owner-start-hero">
          <h1>{title}</h1>
          <p className="owner-start-date">{formatOwnerDate()}</p>
          {cabinet.kind === 'chain_owner' && branches.length > 1 && (
            <label className="owner-start-location">
              <span>Филиал</span>
              <select
                className="location-select"
                data-testid="home-branch-switcher"
                aria-label="Филиал"
                value={cabinet.selectedBranch?.id ?? ''}
                onChange={(e) => cabinet.setSelectedBranchId(e.target.value)}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{branchLabel(b, branches)}</option>
                ))}
              </select>
            </label>
          )}
        </section>

        {audience === 'salon' && cabinet.can('reports') && (
          <section className="owner-start-kpis" aria-label="Показатели дня">
            <div>
              <strong>{formatMoney(revenue)}</strong>
              <span>Выручка</span>
            </div>
            <div>
              <strong>{loadFromAppts}%</strong>
              <span>Загрузка</span>
            </div>
            <div>
              <strong>{todayItems.length}</strong>
              <span>Записей</span>
            </div>
          </section>
        )}

        {audience === 'salon' && !cabinet.can('reports') && (
          <section className="owner-start-kpis" aria-label="Показатели дня">
            <div>
              <strong>{todayItems.length}</strong>
              <span>Сегодня</span>
            </div>
            <div>
              <strong>{pending.length}</strong>
              <span>Ожидают</span>
            </div>
            <div>
              <strong>{dayItems.length}</strong>
              <span>В списке</span>
            </div>
          </section>
        )}

        {audience === 'master' && (
          <section className="owner-start-kpis" aria-label="Показатели дня">
            <div>
              <strong>{todayItems.length}</strong>
              <span>Сегодня</span>
            </div>
            <div>
              <strong>{pending.length}</strong>
              <span>Ожидают</span>
            </div>
            <div>
              <strong>{nextAppt ? new Date(nextAppt.starts_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'}</strong>
              <span>Ближайшая</span>
            </div>
          </section>
        )}

        {showSchedule && (
          <section className="owner-start-day" aria-label={scheduleHeading(selectedDay)}>
            <div className="owner-start-day-head">
              <h2>{scheduleHeading(selectedDay)}</h2>
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
                const person = shortPersonName(audience === 'client' ? a.master_display_name : a.client_display_name) || (audience === 'client' ? 'Мастер' : 'Клиент')
                const other = audience === 'client' ? '' : shortPersonName(a.master_display_name)
                return (
                  <li key={a.id}>
                    <Link className="owner-start-appt" to={`/appointments/${a.id}`}>
                      <time dateTime={a.starts_at}>{time}</time>
                      <span className="owner-start-appt-body">
                        <strong>{person}</strong>
                        <span>
                          {a.service_name}
                          {other ? ` · ${other}` : ''}
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
        )}

        <section className="owner-start-notes" aria-label="Уведомления">
          <div className="owner-start-day-head">
            <h2>
              Уведомления
              {unread.length > 0 && <span className="owner-start-unread">{unread.length}</span>}
            </h2>
            <Link to="/notifications">Все ›</Link>
          </div>
          {notifications.isLoading && <div className="skeleton skeleton-card" />}
          {!notifications.isLoading && notes.length === 0 && (
            <p className="owner-start-empty">Пока нет уведомлений</p>
          )}
          {pushConfig.data?.enabled && pushConfig.data.public_key && (
            <button
              className="owner-start-push"
              type="button"
              onClick={() => {
                void enableDevicePush(accessToken, pushConfig.data!.public_key)
                  .then(() => toast.success('Уведомления на устройстве включены'))
                  .catch((e) => toast.error(userError(e, 'Не удалось включить уведомления')))
              }}
            >
              Уведомления на устройстве
            </button>
          )}
          <ul className="owner-start-note-list">
            {notes.slice(0, 3).map((n) => (
              <li key={n.id}>
                <Link className={`owner-start-note${!n.read_at ? ' is-unread' : ''}`} to={notificationHref(n)}>
                  <strong>{n.title}</strong>
                  <span>{n.body}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {audience === 'client' && <ClientMasters city={user?.city} />}

        {tiles.length > 0 && (
          <section className="owner-start-manage" aria-label="Управление">
            <h2>{audience === 'salon' ? 'Управление' : 'Быстрые действия'}</h2>
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
