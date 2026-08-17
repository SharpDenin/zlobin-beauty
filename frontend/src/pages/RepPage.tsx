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
  priority?: string
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
    queryFn: () => apiRequest<{ items: Array<{ id: string; title: string; status: string; priority?: string }> }>(`/v1/organizations/${orgId}/tasks`, { token: accessToken }),
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
      setOk('Маршрут построен с учётом приоритета и расстояния')
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

  const pending = (deliveries.data?.items ?? []).filter((d) => d.status === 'in_delivery')
  const toCollect = pending
  const route = routes.data?.items[0]
  const stops = useMemo(() => Array.isArray(route?.stops) ? route!.stops as RouteStop[] : [], [route])
  const points = stops.filter((s) => typeof s.latitude === 'number' && typeof s.longitude === 'number') as Array<RouteStop & { latitude: number; longitude: number }>
  const center: [number, number] = points[0] ? [points[0].latitude, points[0].longitude] : [56.0105, 92.8526]
  const a = analytics.data

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
        <div>
          <h1>Кабинет представителя</h1>
          <p className="muted">Доставки, визиты, инкассация. <Hint id="rep-home" title="Маршрут">Карта строит порядок остановок по срокам, окнам и расстоянию.</Hint></p>
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
          <div className="cards-grid">
            <article className="card stack-sm"><span className="muted">Просроченные / задачи</span><strong>{(tasks.data?.items ?? []).filter((t) => t.status === 'open').length}</strong></article>
            <article className="card stack-sm"><span className="muted">Доставок сегодня</span><strong>{a?.deliveries_today ?? pending.length}</strong></article>
            <article className="card stack-sm"><span className="muted">Выполнено</span><strong>{a?.completed_today ?? 0}</strong></article>
            <article className="card stack-sm"><span className="muted">К получению сегодня</span><strong>{formatMoney(a?.collected_today_minor ?? toCollect.reduce((s, d) => s + d.total_minor, 0))}</strong></article>
            <article className="card stack-sm"><span className="muted">Результат месяца</span><strong>{formatMoney(a?.collected_month_minor ?? 0)}</strong></article>
          </div>
          <section className="card stack">
            <h2>Ближайшие задачи</h2>
            {(tasks.data?.items ?? []).length === 0 && <p className="muted">Нет задач</p>}
            {(tasks.data?.items ?? []).map((t) => (
              <article key={t.id} className="list-item row between">
                <strong>{t.title}</strong>
                <span className={`badge ${statusBadgeClass(t.status)}`}>{t.status}</span>
              </article>
            ))}
          </section>
        </>
      )}

      {section === 'map' && (
        <section className="card stack">
          <div className="row between">
            <h2>Карта маршрута</h2>
            <button className="btn btn-primary" type="button" disabled={recommend.isPending || !myRep.data?.id} onClick={() => recommend.mutate()}>
              Оптимизировать маршрут
            </button>
          </div>
          <div className="map-wrap">
            <MapContainer center={center} zoom={12} style={{ height: 360, width: '100%' }}>
              <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {points.map((s, i) => (
                <CircleMarker key={s.id} center={[s.latitude, s.longitude]} radius={10} pathOptions={{ color: '#2f5d50' }}>
                  <Popup>
                    #{i + 1} {s.kind} · {s.km_from_prev ? `${s.km_from_prev.toFixed(1)} км` : ''}
                    {s.window_start ? ` · окно ${new Date(s.window_start).toLocaleTimeString('ru-RU')}` : ''}
                  </Popup>
                </CircleMarker>
              ))}
              {points.length > 1 && (
                <Polyline positions={points.map((s) => [s.latitude, s.longitude] as [number, number])} pathOptions={{ color: '#c4a574' }} />
              )}
            </MapContainer>
          </div>
          <p className="muted">
            {route ? `${route.total_km?.toFixed?.(1) ?? route.total_km ?? '—'} км · ${route.total_minutes ?? '—'} мин · ${route.provider || 'haversine'}` : 'Постройте маршрут'}
          </p>
          <ol className="list">
            {points.map((s, i) => (
              <li key={s.id} className="list-item">
                <strong>{i + 1}. {s.kind}</strong>
                <p className="muted">
                  {[s.km_from_prev != null ? `${s.km_from_prev.toFixed(1)} км` : null, s.eta_at ? `ETA ${new Date(s.eta_at).toLocaleTimeString('ru-RU')}` : null, s.priority]
                    .filter(Boolean).join(' · ')}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {section === 'finance' && (
        <>
          <section className="card stack">
            <h2>К получению сегодня</h2>
            {toCollect.length === 0 && <p className="muted">Нет заказов с инкассацией</p>}
            {toCollect.map((d) => (
              <article key={d.id} className="list-item">
                <div className="row between">
                  <strong>{d.delivery_address || 'Салон'}</strong>
                  <span>{formatMoney(d.total_minor)}</span>
                </div>
                <p className="muted">{d.payment_method || 'cash'} · {clientOrderLabel(d.status)}</p>
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
            <div className="row between"><strong>Итог дня</strong><strong>{formatMoney(toCollect.reduce((s, d) => s + d.total_minor, 0))}</strong></div>
          </section>
          <section className="card stack">
            <h2>Месяц</h2>
            <div className="cards-grid">
              <article className="card stack-sm"><span className="muted">Получено</span><strong>{formatMoney(a?.collected_month_minor ?? 0)}</strong></article>
              <article className="card stack-sm"><span className="muted">Ожидается</span><strong>{formatMoney(a?.expected_month_minor ?? 0)}</strong></article>
              <article className="card stack-sm"><span className="muted">Заказов</span><strong>{a?.orders_month ?? 0}</strong></article>
            </div>
          </section>
        </>
      )}

      {section === 'analytics' && (
        <section className="card stack">
          <h2>Личная аналитика</h2>
          <div className="cards-grid">
            <article className="card stack-sm"><span className="muted">Доставок сегодня</span><strong>{a?.deliveries_today ?? 0}</strong></article>
            <article className="card stack-sm"><span className="muted">Выполнено / осталось</span><strong>{a?.completed_today ?? 0} / {a?.remaining_today ?? 0}</strong></article>
            <article className="card stack-sm"><span className="muted">Собрано</span><strong>{formatMoney(a?.collected_today_minor ?? 0)}</strong></article>
          </div>
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <AreaChart data={a?.sales_dynamics ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period" />
                <YAxis />
                <Tooltip />
                <Area dataKey="collected_minor" stroke="#2f5d50" fill="#d7ebe3" name="Собрано" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={a?.popular_products ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" hide />
                <YAxis />
                <Tooltip />
                <Bar dataKey="revenue_minor" fill="#c4a574" name="Продажи" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
    </main>
  )
}
