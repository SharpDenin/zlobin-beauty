import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCabinet } from '@/shared/lib/cabinet'
import { formatMoney } from '@/shared/lib/money'
import { statusBadgeClass, statusLabel } from '@/shared/lib/status'
import { Hint } from '@/shared/ui/Hint'
import { CalendarPage } from '@/pages/CalendarPage'

type Appointment = {
  id: string
  service_name: string
  status: string
  starts_at: string
  price_minor: number
}

type Notification = {
  id: string
  type: string
  title: string
  body: string
  read_at: string | null
  created_at: string
}

type WidgetId =
  | 'alerts'
  | 'calendar'
  | 'today'
  | 'upcoming'
  | 'pending'
  | 'messages'
  | 'tasks'
  | 'clients_today'
  | 'orders'
  | 'deliveries'
  | 'analytics'

type WidgetSize = 'small' | 'medium' | 'large' | 'full'

type WidgetLayout = { id: WidgetId; size: WidgetSize; enabled: boolean }

const LIBRARY: Array<{ id: WidgetId; title: string; sizes: WidgetSize[] }> = [
  { id: 'alerts', title: 'Важные сообщения', sizes: ['full', 'large'] },
  { id: 'calendar', title: 'Календарь', sizes: ['full', 'large'] },
  { id: 'today', title: 'Сегодня', sizes: ['small', 'medium'] },
  { id: 'upcoming', title: 'Ближайшие записи', sizes: ['medium', 'large'] },
  { id: 'pending', title: 'Ожидают подтверждения', sizes: ['small', 'medium'] },
  { id: 'messages', title: 'Сообщения', sizes: ['small', 'medium'] },
  { id: 'tasks', title: 'Задачи', sizes: ['small', 'medium'] },
  { id: 'clients_today', title: 'Клиенты сегодня', sizes: ['small', 'medium'] },
  { id: 'orders', title: 'Заказы', sizes: ['small', 'medium'] },
  { id: 'deliveries', title: 'Доставки', sizes: ['small', 'medium'] },
  { id: 'analytics', title: 'Сводка аналитики', sizes: ['medium', 'large'] },
]

const DEFAULT_LAYOUT: WidgetLayout[] = [
  { id: 'alerts', size: 'full', enabled: true },
  { id: 'today', size: 'small', enabled: true },
  { id: 'pending', size: 'small', enabled: true },
  { id: 'upcoming', size: 'medium', enabled: true },
  { id: 'calendar', size: 'full', enabled: true },
]

function normalizeLayout(raw: unknown): WidgetLayout[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_LAYOUT
  const out: WidgetLayout[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const rawId = String(rec.id || rec.type || '')
    const mapped = rawId === 'important_messages' ? 'alerts' : rawId
    if (!LIBRARY.some((w) => w.id === mapped)) continue
    const size = (['small', 'medium', 'large', 'full'].includes(String(rec.size)) ? rec.size : 'medium') as WidgetSize
    out.push({ id: mapped as WidgetId, size, enabled: rec.enabled !== false })
  }
  return out.length ? out : DEFAULT_LAYOUT
}

export function DashboardPage() {
  const { user, accessToken } = useAuth()
  const cabinet = useCabinet()
  const qc = useQueryClient()
  const [libraryOpen, setLibraryOpen] = useState(false)

  const layoutQ = useQuery({
    queryKey: ['me-dashboard'],
    queryFn: () => apiRequest<{ widgets: unknown }>('/v1/me/dashboard', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const layout = normalizeLayout(layoutQ.data?.widgets)

  const save = useMutation({
    mutationFn: (widgets: WidgetLayout[]) =>
      apiRequest('/v1/me/dashboard', { method: 'PUT', token: accessToken, body: { widgets } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me-dashboard'] }),
  })

  const appointments = useQuery({
    queryKey: ['home-appointments', 'master'],
    queryFn: () => apiRequest<{ items: Appointment[] }>('/v1/appointments/mine?role=master', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const notes = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiRequest<{ items: Notification[] }>('/v1/notifications', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const items = appointments.data?.items ?? []
  const todayKey = new Date().toISOString().slice(0, 10)
  const today = items.filter((a) => a.starts_at.slice(0, 10) === todayKey)
  const pending = items.filter((a) => a.status === 'pending_confirmation')
  const upcoming = [...items]
    .filter((a) => ['pending_confirmation', 'confirmed', 'in_progress'].includes(a.status))
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
    .slice(0, 5)
  const unread = (notes.data?.items ?? []).filter((n) => !n.read_at).slice(0, 6)

  function patchLayout(next: WidgetLayout[]) {
    save.mutate(next)
  }

  return (
    <main className="page stack">
      <div className="row between">
        <div className="stack-sm">
          <p className="muted">{cabinet.label}</p>
          <h1>Сегодня, {user?.display_name}</h1>
          <p className="muted">
            Важные события сверху, календарь ниже.
            <Hint id="dash-layout" title="Кабинет">
              Добавляйте и убирайте виджеты. Размер только small / medium / large / full — так сетка не ломается.
            </Hint>
          </p>
        </div>
        <button className="btn btn-secondary" type="button" onClick={() => setLibraryOpen(true)}>
          Настроить dashboard
        </button>
      </div>

      <div className="dash-grid">
        {layout.filter((w) => w.enabled).map((w) => (
          <section key={w.id} className={`dash-widget size-${w.size}`}>
            {w.id === 'alerts' && (
              <div className="stack">
                <h2>Важное</h2>
                {unread.length === 0 && pending.length === 0 && (
                  <p className="muted">Нет срочных уведомлений</p>
                )}
                <div className="list">
                  {pending.map((a) => (
                    <Link key={a.id} to={`/appointments/${a.id}`} className="list-item">
                      <strong>Запись ожидает подтверждения</strong>
                      <p>{a.service_name} · {new Date(a.starts_at).toLocaleString('ru-RU')}</p>
                    </Link>
                  ))}
                  {unread.map((n) => (
                    <article key={n.id} className="list-item">
                      <strong>{n.title}</strong>
                      <p>{n.body}</p>
                    </article>
                  ))}
                </div>
              </div>
            )}
            {w.id === 'today' && (
              <Link className="dashboard-tile" to="/calendar">
                <span className="muted">Сегодня</span>
                <strong>{today.length}</strong>
                <span className="muted">записей</span>
              </Link>
            )}
            {w.id === 'pending' && (
              <Link className="dashboard-tile" to="/appointments">
                <span className="muted">Подтверждения</span>
                <strong>{pending.length}</strong>
                <span className="muted">ожидают</span>
              </Link>
            )}
            {w.id === 'upcoming' && (
              <div className="stack">
                <div className="row between"><h2>Ближайшие</h2><Link to="/appointments">Все</Link></div>
                {upcoming.length === 0 && <p className="muted">Нет ближайших записей</p>}
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
            )}
            {w.id === 'calendar' && <CalendarPage embedded />}
            {w.id === 'messages' && (
              <div className="stack">
                <h2>Сообщения</h2>
                <Link to="/notifications">Открыть уведомления</Link>
              </div>
            )}
            {w.id === 'tasks' && (
              <div className="stack">
                <h2>Задачи</h2>
                <p className="muted">Операционные задачи салона появятся здесь.</p>
              </div>
            )}
            {w.id === 'clients_today' && (
              <Link className="dashboard-tile" to="/clients">
                <span className="muted">Клиенты сегодня</span>
                <strong>{today.length}</strong>
              </Link>
            )}
            {w.id === 'orders' && cabinet.can('cosmetics') && (
              <Link className="dashboard-tile" to="/cosmetics/orders">
                <span className="muted">Заказы</span>
                <strong>→</strong>
              </Link>
            )}
            {w.id === 'deliveries' && (
              <div className="stack"><h2>Доставки</h2><p className="muted">Нет активных поставок на сегодня</p></div>
            )}
            {w.id === 'analytics' && cabinet.can('reports') && (
              <Link className="dashboard-tile" to="/reports">
                <span className="muted">Аналитика салона</span>
                <strong>→</strong>
              </Link>
            )}
            {w.id === 'analytics' && !cabinet.can('reports') && (
              <div className="dashboard-tile">
                <span className="muted">Загрузка</span>
                <strong>{today.length}</strong>
                <span className="muted">записей сегодня</span>
              </div>
            )}
          </section>
        ))}
      </div>

      {libraryOpen && (
        <div className="more-drawer" role="dialog" onClick={() => setLibraryOpen(false)}>
          <div className="more-panel stack" onClick={(e) => e.stopPropagation()}>
            <div className="row between">
              <h2>Виджеты</h2>
              <button className="btn btn-secondary btn-compact" type="button" onClick={() => setLibraryOpen(false)}>Закрыть</button>
            </div>
            {LIBRARY.map((w) => {
              const current = layout.find((x) => x.id === w.id)
              return (
                <article key={w.id} className="list-item">
                  <div className="row between">
                    <strong>{w.title}</strong>
                    <label className="field-check">
                      <input
                        type="checkbox"
                        checked={current?.enabled !== false && Boolean(current)}
                        onChange={(e) => {
                          const exists = layout.find((x) => x.id === w.id)
                          if (!exists && e.target.checked) {
                            patchLayout([...layout, { id: w.id, size: w.sizes[0], enabled: true }])
                            return
                          }
                          patchLayout(layout.map((x) => x.id === w.id ? { ...x, enabled: e.target.checked } : x))
                        }}
                      />
                      <span>Показать</span>
                    </label>
                  </div>
                  <div className="row">
                    {w.sizes.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`chip ${current?.size === s ? 'active' : ''}`}
                        onClick={() => patchLayout(layout.map((x) => x.id === w.id ? { ...x, size: s } : x))}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </article>
              )
            })}
            {save.isError && <div className="state-box error">{save.error instanceof ApiError ? save.error.message : 'Не удалось сохранить'}</div>}
          </div>
        </div>
      )}
    </main>
  )
}
