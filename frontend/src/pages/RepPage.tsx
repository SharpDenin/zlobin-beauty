import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup } from 'react-leaflet'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart, Bar } from 'recharts'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/shared/lib/money'
import { clientOrderLabel, statusBadgeClass } from '@/shared/lib/status'
import { Hint } from '@/shared/ui/Hint'
import { CalendarPage } from '@/pages/CalendarPage'
import 'leaflet/dist/leaflet.css'

type OrgItem = { organization: { id: string; name: string } }
type Delivery = {
  id: string
  status: string
  total_minor: number
  delivery_address: string
  delivery_comment: string
  payment_method?: string
  amount_collected_minor?: number
  items: Array<{ product_id: string; product_name: string; brand: string; qty: number; price_minor: number }>
}
type RouteStop = {
  id: string
  kind: string
  latitude?: number | null
  longitude?: number | null
  sort_order: number
  km_from_prev?: number
  eta_at?: string | null
  window_start?: string | null
  window_end?: string | null
  deadline_at?: string | null
  priority?: string
  status?: string
}
type RouteItem = {
  id: string
  status: string
  total_km?: number
  total_minutes?: number
  label?: string
  provider?: string
  stops?: RouteStop[] | number
}
type Analytics = {
  deliveries_today?: number
  completed_today?: number
  remaining_today?: number
  collected_today_minor?: number
  collected_month_minor?: number
  expected_month_minor?: number
  orders_month?: number
  sales_dynamics?: Array<{ period: string; revenue_minor: number; collected_minor?: number; orders?: number }>
  popular_products?: Array<{ product_id: string; name: string; revenue_minor: number }>
}

export function RepPage() {
  const { accessToken } = useAuth()
  const loc = useLocation()
  const section = loc.pathname.includes('/map') ? 'map'
    : loc.pathname.includes('/finance') ? 'finance'
      : loc.pathname.includes('/analytics') ? 'analytics'
        : 'home'
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [collected, setCollected] = useState('')
  const [paymentReceived, setPaymentReceived] = useState(false)
  const [selectedStop, setSelectedStop] = useState<string | null>(null)

  const orgs = useQuery({
    queryKey: ['orgs-mine'],
    queryFn: () => apiRequest<{ items: OrgItem[] }>('/v1/organizations/mine', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const orgId = orgs.data?.items[0]?.organization.id
  const deliveries = useQuery({
    queryKey: ['rep-deliveries', orgId],
    queryFn: () => apiRequest<{ items: Delivery[] }>(`/v1/commerce/rep/deliveries?organization_id=${orgId}`, { token: accessToken }),
    enabled: Boolean(accessToken && orgId),
  })
  const tasks = useQuery({
    queryKey: ['rep-tasks', orgId],
    queryFn: () => apiRequest<{ items: Array<{ id: string; title: string; status: string; priority?: string; due_at?: string }> }>(`/v1/organizations/${orgId}/tasks`, { token: accessToken }),
    enabled: Boolean(accessToken && orgId),
  })
  const myRep = useQuery({
    queryKey: ['my-rep'],
    queryFn: () => apiRequest<{ id: string }>(`/v1/me/representative`, { token: accessToken }),
    enabled: Boolean(accessToken),
    retry: false,
  })
  const routes = useQuery({
    queryKey: ['rep-routes', orgId],
    queryFn: () => apiRequest<{ items: RouteItem[] }>(`/v1/organizations/${orgId}/routes`, { token: accessToken }),
    enabled: Boolean(accessToken && orgId),
  })
  const analytics = useQuery({
    queryKey: ['rep-analytics', orgId],
    queryFn: () => apiRequest<Analytics>(`/v1/commerce/rep/analytics?organization_id=${orgId}&period=month`, { token: accessToken }),
    enabled: Boolean(accessToken && orgId),
  })

  const recommend = useMutation({
    mutationFn: () =>
      apiRequest(`/v1/organizations/${orgId}/routes/recommend`, {
        token: accessToken,
        body: {
          representative_id: myRep.data?.id,
          date: new Date().toISOString().slice(0, 10),
          origin_lat: 56.010543,
          origin_lng: 92.852576,
          stops: (deliveries.data?.items ?? []).slice(0, 5).map((d, i) => ({
            kind: 'delivery',
            priority: i === 0 ? 'high' : 'normal',
            expected_duration_min: 20,
            latitude: 56.010543 + i * 0.01,
            longitude: 92.852576 + i * 0.012,
            note: d.delivery_address,
          })),
        },
      }),
    onSuccess: async () => {
      setOk('Рекомендованный маршрут построен')
      await qc.invalidateQueries({ queryKey: ['rep-routes'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось построить маршрут'),
  })

  const complete = useMutation({
    mutationFn: (order: Delivery) =>
      apiRequest(`/v1/commerce/rep/deliveries/${order.id}/complete`, {
        token: accessToken,
        body: {
          items: order.items.map((it) => ({ product_id: it.product_id, qty_delivered: it.qty })),
          note: note.trim(),
          amount_collected_minor: Math.round((Number(collected) || 0) * 100),
          payment_received: paymentReceived,
        },
      }),
    onSuccess: async () => {
      setOk('Доставка подтверждена')
      setActiveId(null)
      await qc.invalidateQueries({ queryKey: ['rep-deliveries'] })
      await qc.invalidateQueries({ queryKey: ['rep-analytics'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Ошибка доставки'),
  })

  const pending = (deliveries.data?.items ?? []).filter((d) => d.status === 'in_delivery' || d.status === 'confirmed' || d.status === 'picking')
  const toCollect = pending
  const collectedToday = toCollect.reduce((s, d) => s + (d.amount_collected_minor ?? 0), 0)
  const pendingToday = toCollect.reduce((s, d) => s + Math.max(0, d.total_minor - (d.amount_collected_minor ?? 0)), 0)
  const route = routes.data?.items[0]
  const stops = useMemo(() => Array.isArray(route?.stops) ? [...route!.stops as RouteStop[]].sort((a, b) => a.sort_order - b.sort_order) : [], [route])
  const points = stops.filter((s) => typeof s.latitude === 'number' && typeof s.longitude === 'number') as Array<RouteStop & { latitude: number; longitude: number }>
  const center: [number, number] = points[0] ? [points[0].latitude, points[0].longitude] : [56.0105, 92.8526]
  const a = analytics.data
  const openTasks = (tasks.data?.items ?? []).filter((t) => t.status === 'open' || t.status === 'in_progress')
  const overdueTasks = (tasks.data?.items ?? []).filter((t) => t.status === 'overdue' || (t.due_at && new Date(t.due_at) < new Date() && t.status !== 'done' && t.status !== 'completed'))
  const nextStop = points.find((s) => s.status !== 'done' && s.status !== 'completed') ?? points[0]

  if (orgs.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>
  if (!orgId) {
    return <main className="page"><div className="state-box">Нужна организация поставщика, где вы представитель.</div></main>
  }

  const tabs = [
    { to: '/rep', label: 'Сегодня' },
    { to: '/rep/map', label: 'Маршрут' },
    { to: '/rep/finance', label: 'Деньги' },
    { to: '/rep/analytics', label: 'Аналитика' },
  ]

  return (
    <main className="page stack">
      <div className="row between">
        <div className="stack-sm">
          <p className="eyebrow">Представитель</p>
          <h1>Кабинет представителя</h1>
          <p className="muted">Рабочий день: маршрут, доставки и инкассация. <Hint id="rep-home" title="Маршрут">Карта показывает рекомендованный порядок остановок с расстоянием и ETA.</Hint></p>
        </div>
      </div>
      <div className="tabs">
        {tabs.map((t) => (
          <Link key={t.to} to={t.to} className={loc.pathname === t.to ? 'active' : ''}>{t.label}</Link>
        ))}
      </div>
      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}

      {section === 'home' && (
        <>
          <div className="kpi-grid">
            <article className="card stack-sm"><span className="muted">Задач сегодня</span><strong>{openTasks.length}</strong></article>
            <article className="card stack-sm"><span className="muted">Доставок сегодня</span><strong>{a?.deliveries_today ?? pending.length}</strong></article>
            <article className="card stack-sm"><span className="muted">Выполнено</span><strong>{a?.completed_today ?? 0}</strong></article>
            <article className="card stack-sm"><span className="muted">Просрочено</span><strong>{overdueTasks.length}</strong></article>
            <article className="card stack-sm"><span className="muted">К получению сегодня</span><strong>{formatMoney(a?.collected_today_minor ?? pendingToday)}</strong></article>
            <article className="card stack-sm"><span className="muted">К получению месяц</span><strong>{formatMoney(a?.expected_month_minor ?? 0)}</strong></article>
          </div>
          <section className="card stack">
            <div className="row between"><h2>Маршрут</h2><Link to="/rep/map">Открыть карту</Link></div>
            <p className="muted">{route ? `${route.label || 'Рекомендованный маршрут'} · ${route.total_km?.toFixed?.(1) ?? route.total_km ?? '—'} км · ${route.total_minutes ?? '—'} мин` : 'Маршрут ещё не построен'}</p>
            {nextStop && <p>Следующая остановка: {stopKind(nextStop.kind)} {nextStop.eta_at ? `· ETA ${new Date(nextStop.eta_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ''}</p>}
          </section>
          <section className="card stack">
            <h2>Ближайшие задачи</h2>
            {openTasks.length === 0 && <p className="muted">Нет задач</p>}
            {openTasks.map((t) => (
              <article key={t.id} className="list-item row between">
                <strong>{t.title}</strong>
                <span className={`badge ${statusBadgeClass(t.status)}`}>{t.status}</span>
              </article>
            ))}
          </section>
          <CalendarPage embedded />
        </>
      )}

      {section === 'map' && (
        <section className="card stack">
          <div className="row between">
            <div>
              <p className="eyebrow">Рекомендованный маршрут</p>
              <h2>Карта маршрута</h2>
            </div>
            <button className="btn btn-primary" type="button" disabled={recommend.isPending || !myRep.data?.id} onClick={() => recommend.mutate()}>
              {recommend.isPending ? 'Строим…' : 'Построить рекомендованный маршрут'}
            </button>
          </div>
          <p className="muted">
            {route
              ? `${points.length} остановок · ${Number(route.total_km ?? 0).toFixed(1)} км · ETA ${route.total_minutes ?? '—'} мин`
              : 'Постройте маршрут по сегодняшним доставкам'}
          </p>
          <div className="map-wrap">
            <MapContainer center={center} zoom={12} style={{ height: 380, width: '100%' }}>
              <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {points.map((s, i) => (
                <CircleMarker
                  key={s.id}
                  center={[s.latitude, s.longitude]}
                  radius={nextStop?.id === s.id ? 14 : 10}
                  pathOptions={{ color: nextStop?.id === s.id ? '#c0392b' : '#2f5d50', fillOpacity: 0.85 }}
                  eventHandlers={{ click: () => setSelectedStop(s.id) }}
                >
                  <Popup>
                    <strong>#{i + 1} {stopKind(s.kind)}</strong>
                    <div>{s.eta_at ? `ETA ${new Date(s.eta_at).toLocaleTimeString('ru-RU')}` : 'ETA уточняется'}</div>
                    <div>{s.km_from_prev ? `${s.km_from_prev.toFixed(1)} км от предыдущей` : ''}</div>
                  </Popup>
                </CircleMarker>
              ))}
              {points.length > 1 && (
                <Polyline positions={points.map((s) => [s.latitude, s.longitude] as [number, number])} pathOptions={{ color: '#c4a574', weight: 4 }} />
              )}
            </MapContainer>
          </div>
          <ol className="list">
            {points.map((s, i) => {
              const delivery = toCollect[i]
              const open = selectedStop === s.id
              return (
                <li key={s.id} className="list-item" onClick={() => setSelectedStop(s.id)}>
                  <div className="row between">
                    <strong>{i + 1}. {stopKind(s.kind)}{nextStop?.id === s.id ? ' · следующая' : ''}</strong>
                    <span>{s.km_from_prev != null ? `${s.km_from_prev.toFixed(1)} км` : ''}</span>
                  </div>
                  <p className="muted">
                    {[delivery?.delivery_address || 'Салон', s.eta_at ? `ETA ${new Date(s.eta_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : null, s.deadline_at ? `до ${new Date(s.deadline_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : null]
                      .filter(Boolean).join(' · ')}
                  </p>
                  {open && (
                    <div className="stack-sm" style={{ marginTop: 8 }}>
                      <p><strong>Адрес:</strong> {delivery?.delivery_address || 'не указан'}</p>
                      <p><strong>Заказ:</strong> {delivery ? formatMoney(delivery.total_minor) : 'задача'}</p>
                      <p><strong>К получению:</strong> {delivery ? formatMoney(Math.max(0, delivery.total_minor - (delivery.amount_collected_minor ?? 0))) : '—'}</p>
                      {delivery && <Link className="btn btn-secondary btn-compact" to="/rep/finance">Отметить оплату</Link>}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      )}

      {section === 'finance' && (
        <>
          <section className="card stack">
            <h2>Сегодня</h2>
            {toCollect.length === 0 && <p className="muted">Нет заказов с инкассацией</p>}
            {toCollect.map((d) => (
              <article key={d.id} className="list-item">
                <div className="row between">
                  <strong>{d.delivery_address || 'Салон'}</strong>
                  <span>{formatMoney(d.total_minor)}</span>
                </div>
                <p className="muted">заказ · {d.payment_method || 'наличные'} · {clientOrderLabel(d.status)}</p>
                <p className="muted">собрано {formatMoney(d.amount_collected_minor ?? 0)} · ожидает {formatMoney(Math.max(0, d.total_minor - (d.amount_collected_minor ?? 0)))}</p>
                <button className="btn btn-primary btn-compact" type="button" onClick={() => setActiveId(d.id)}>Отметить оплату</button>
                {activeId === d.id && (
                  <div className="stack" style={{ marginTop: 12 }}>
                    <input value={collected} onChange={(e) => setCollected(e.target.value)} placeholder="Получено, ₽" />
                    <label className="field-check">
                      <input type="checkbox" checked={paymentReceived} onChange={(e) => setPaymentReceived(e.target.checked)} />
                      <span>Оплата получена</span>
                    </label>
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Комментарий" />
                    <button className="btn btn-primary" type="button" onClick={() => complete.mutate(d)}>Сохранить</button>
                  </div>
                )}
              </article>
            ))}
            <div className="row between"><strong>Итого сегодня</strong><strong>{formatMoney(toCollect.reduce((s, d) => s + d.total_minor, 0))}</strong></div>
            <p className="muted">собрано {formatMoney(collectedToday)} · ожидает {formatMoney(pendingToday)}</p>
          </section>
          <section className="card stack">
            <h2>Месяц</h2>
            <div className="kpi-grid">
              <article className="card stack-sm"><span className="muted">Collected</span><strong>{formatMoney(a?.collected_month_minor ?? 0)}</strong></article>
              <article className="card stack-sm"><span className="muted">Expected</span><strong>{formatMoney(a?.expected_month_minor ?? 0)}</strong></article>
              <article className="card stack-sm"><span className="muted">Orders</span><strong>{a?.orders_month ?? 0}</strong></article>
            </div>
            <div className="dashboard-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={a?.sales_dynamics ?? []}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="period" />
                  <YAxis tickFormatter={(v) => String(Math.round(Number(v) / 100))} />
                  <Tooltip formatter={(v) => formatMoney(Number(v))} />
                  <Area type="monotone" dataKey="collected_minor" stroke="#2f6f78" fill="#d7ebe3" name="Собрано" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>
        </>
      )}

      {section === 'analytics' && (
        <div className="stack">
          <h2>Личная аналитика</h2>
          <div className="kpi-grid">
            <article className="card stack-sm"><span className="muted">Доставок сегодня</span><strong>{a?.deliveries_today ?? 0}</strong></article>
            <article className="card stack-sm"><span className="muted">Выполнено / осталось</span><strong>{a?.completed_today ?? 0} / {a?.remaining_today ?? 0}</strong></article>
            <article className="card stack-sm"><span className="muted">Собрано</span><strong>{formatMoney(a?.collected_today_minor ?? 0)}</strong></article>
          </div>
          <section className="card stack">
            <h2>Deliveries over time</h2>
            <div className="dashboard-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={a?.sales_dynamics ?? []}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="period" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="orders" fill="#c4a574" name="Доставки" radius={6} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="card stack">
            <h2>Money collected</h2>
            <div className="dashboard-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={a?.sales_dynamics ?? []}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="period" />
                  <YAxis tickFormatter={(v) => String(Math.round(Number(v) / 100))} />
                  <Tooltip formatter={(v) => formatMoney(Number(v))} />
                  <Area type="monotone" dataKey="collected_minor" stroke="#2f6f78" fill="#d7ebe3" name="Собрано" />
                  <Area type="monotone" dataKey="revenue_minor" stroke="#8f6a55" fill="transparent" name="Продажи" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="card stack">
            <h2>Popular products</h2>
            {(a?.popular_products ?? []).length === 0 && <p className="muted">Пока нет продаж</p>}
            {(a?.popular_products ?? []).map((p) => (
              <article key={p.product_id} className="list-item row between">
                <span>{p.name}</span>
                <span>{formatMoney(p.revenue_minor)}</span>
              </article>
            ))}
          </section>
        </div>
      )}
    </main>
  )
}

function stopKind(kind: string) {
  if (kind === 'delivery') return 'Доставка'
  if (kind === 'salon_visit') return 'Посещение салона'
  if (kind === 'task') return 'Задача'
  return 'Остановка'
}
