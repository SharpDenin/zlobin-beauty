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
import { CHART } from '@/shared/ui/chart-theme'
import { useSupplierOrg } from '@/shared/lib/commerce'
import 'leaflet/dist/leaflet.css'

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
  salon_name?: string
  address_line?: string
  city?: string
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
  expected_today_minor?: number
  collected_month_minor?: number
  expected_month_minor?: number
  orders_month?: number
  completion_rate?: number
  average_order_minor?: number
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

  const { orgs, supplierOrgId } = useSupplierOrg()
  const orgId = supplierOrgId
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
          stops: (deliveries.data?.items ?? []).slice(0, 5).map((d, i) => {
            const start = new Date()
            start.setHours(11 + i, 30, 0, 0)
            const end = new Date(start.getTime() + 40 * 60_000)
            return {
              kind: 'delivery',
              priority: i === 0 ? 'high' : 'normal',
              expected_duration_min: 20,
              latitude: 56.010543 + i * 0.01,
              longitude: 92.852576 + i * 0.012,
              window_start: start.toISOString(),
              window_end: end.toISOString(),
              deadline_at: end.toISOString(),
              note: d.delivery_address,
            }
          }),
        },
      }),
    onSuccess: async () => {
      setOk('Рекомендованный маршрут построен')
      await qc.invalidateQueries({ queryKey: ['rep-routes'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось построить маршрут'),
  })

  const stopStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest(`/v1/organizations/${orgId}/routes/stops/${id}/status`, { token: accessToken, body: { status } }),
    onSuccess: async () => {
      setOk('Статус остановки обновлён')
      await qc.invalidateQueries({ queryKey: ['rep-routes'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось обновить остановку'),
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
  const route = (routes.data?.items ?? []).find((r) => Array.isArray(r.stops) && r.stops.length > 1) ?? routes.data?.items[0]
  const stops = useMemo(() => Array.isArray(route?.stops) ? [...route!.stops as RouteStop[]].sort((a, b) => a.sort_order - b.sort_order) : [], [route])
  const points = stops.filter((s) => typeof s.latitude === 'number' && typeof s.longitude === 'number') as Array<RouteStop & { latitude: number; longitude: number }>
  const center: [number, number] = points[0] ? [points[0].latitude, points[0].longitude] : [56.0105, 92.8526]
  const a = analytics.data
  const openTasks = (tasks.data?.items ?? []).filter((t) => t.status === 'open' || t.status === 'in_progress')
  const overdueTasks = (tasks.data?.items ?? []).filter((t) => t.status === 'overdue' || (t.due_at && new Date(t.due_at) < new Date() && t.status !== 'done' && t.status !== 'completed'))
  const nextStop = points.find((s) => s.status !== 'done' && s.status !== 'completed' && s.status !== 'failed') ?? points[0]
  const deliveryStops = points.filter((s) => s.kind === 'delivery')

  const nearestDelivery = pending[0]
  const doneStops = stops.filter((s) => s.status === 'done' || s.status === 'completed').length
  const leftStops = Math.max(0, points.length - doneStops)
  const nearestDeadline = points
    .map((s) => s.deadline_at || s.window_end)
    .filter(Boolean)
    .sort()[0]

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
          {(overdueTasks.length > 0 || nearestDelivery) && (
            <section className="card stack">
              <h2>Важно сейчас</h2>
              {overdueTasks.length > 0 && <p className="badge badge-danger">Просроченные задачи: {overdueTasks.length}</p>}
              {overdueTasks.slice(0, 3).map((t) => (
                <article key={t.id} className="list-item row between"><strong>{t.title}</strong><span>просрочено</span></article>
              ))}
              {nearestDelivery && (
                <p>Ближайшая доставка: {nearestDelivery.delivery_address || 'салон'} · {formatMoney(nearestDelivery.total_minor)}</p>
              )}
            </section>
          )}
          <div className="kpi-grid">
            <article className="card stack-sm"><span className="muted">Задач сегодня</span><strong>{openTasks.length}</strong></article>
            <article className="card stack-sm"><span className="muted">Доставок сегодня</span><strong>{a?.deliveries_today ?? pending.length}</strong></article>
            <article className="card stack-sm"><span className="muted">Выполнено</span><strong>{a?.completed_today ?? 0}</strong></article>
            <article className="card stack-sm"><span className="muted">Просрочено</span><strong>{overdueTasks.length}</strong></article>
            <article className="card stack-sm"><span className="muted">К получению сегодня</span><strong>{formatMoney(a?.expected_today_minor ?? pendingToday)}</strong></article>
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
              ? `${points.length} остановок · пройдено ${doneStops} · осталось ${leftStops} · ${Number(route.total_km ?? 0).toFixed(1)} км · прогноз ${route.total_minutes ?? '—'} мин${nearestDeadline ? ` · ближайший дедлайн ${new Date(nearestDeadline).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ''}`
              : 'Постройте рекомендованный маршрут по сегодняшним доставкам'}
          </p>
          <p className="muted">Город: Красноярск · эвристика расстояний (haversine), не идеально оптимальный маршрут.</p>
          <div className="map-wrap map-compact">
            <MapContainer center={center} zoom={12} style={{ height: 380, width: '100%' }}>
              <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  {points.map((s, i) => (
                <CircleMarker
                  key={s.id}
                  center={[s.latitude, s.longitude]}
                  radius={nextStop?.id === s.id ? 14 : 10}
                  pathOptions={{
                    color: s.status === 'done' || s.status === 'completed' ? CHART.success : nextStop?.id === s.id ? CHART.danger : CHART.accent,
                    fillOpacity: 0.85,
                  }}
                  eventHandlers={{ click: () => setSelectedStop(s.id) }}
                >
                  <Popup>
                    <strong>#{i + 1} {stopKind(s.kind)}</strong>
                    <div>{s.status === 'done' ? 'пройдена' : s.status === 'failed' ? 'не удалось' : nextStop?.id === s.id ? 'следующая' : 'ожидает'}</div>
                    <div>{s.eta_at ? `ETA ${new Date(s.eta_at).toLocaleTimeString('ru-RU')}` : 'ETA уточняется'}</div>
                  </Popup>
                </CircleMarker>
              ))}
              {points.length > 1 && (
                <Polyline positions={points.map((s) => [s.latitude, s.longitude] as [number, number])} pathOptions={{ color: CHART.gold, weight: 4 }} />
              )}
            </MapContainer>
          </div>
          <ol className="list">
            {points.map((s, i) => {
              const delivery = s.kind === 'delivery' ? toCollect[Math.max(0, deliveryStops.indexOf(s))] : undefined
              const open = selectedStop === s.id
              const title = s.salon_name || delivery?.delivery_address || stopKind(s.kind)
              const address = s.address_line || delivery?.delivery_address || s.city || ''
              const windowLabel = formatWindow(s.window_start, s.window_end, s.eta_at)
              const collect = delivery ? Math.max(0, delivery.total_minor - (delivery.amount_collected_minor ?? 0)) : 0
              const orderLabel = delivery?.items?.[0]?.product_name ? `Заказ · ${delivery.items[0].product_name}` : delivery ? 'Заказ' : stopKind(s.kind)
              return (
                <li key={s.id} className="list-item" onClick={() => setSelectedStop(s.id)}>
                  <div className="row between">
                    <strong>{i + 1}. {title}{nextStop?.id === s.id ? ' · следующая' : s.status === 'done' || s.status === 'completed' ? ' · пройдена' : ''}</strong>
                    <span>{s.km_from_prev != null ? `${s.km_from_prev.toFixed(1)} км` : ''}</span>
                  </div>
                  {address && <p className="muted">{address}</p>}
                  <p className="muted">{[windowLabel, orderLabel, collect ? `Получить ${formatMoney(collect)}` : null].filter(Boolean).join(' · ')}</p>
                  {open && (
                    <div className="stack-sm" style={{ marginTop: 8 }}>
                      <p><strong>Салон:</strong> {title}</p>
                      <p><strong>Адрес:</strong> {address || 'не указан'}</p>
                      <p><strong>Окно:</strong> {windowLabel || 'уточняется'}</p>
                      <p><strong>Задача / заказ:</strong> {orderLabel}</p>
                      <p><strong>Дедлайн:</strong> {s.deadline_at ? new Date(s.deadline_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'}</p>
                      <p><strong>К получению:</strong> {delivery ? formatMoney(collect) : '—'}</p>
                      <p><strong>Статус:</strong> {stopStatusLabel(s.status)}</p>
                      {delivery && <Link className="btn btn-secondary btn-compact" to="/rep/finance">Открыть заказ</Link>}
                      <Link className="btn btn-secondary btn-compact" to="/search">Открыть салон</Link>
                      <div className="row">
                        <button className="btn btn-secondary btn-compact" type="button" onClick={(e) => { e.stopPropagation(); stopStatus.mutate({ id: s.id, status: 'en_route' }) }}>Начать</button>
                        <button className="btn btn-primary btn-compact" type="button" onClick={(e) => { e.stopPropagation(); stopStatus.mutate({ id: s.id, status: 'done' }) }}>Выполнено</button>
                        <button className="btn btn-secondary btn-compact" type="button" onClick={(e) => { e.stopPropagation(); stopStatus.mutate({ id: s.id, status: 'failed' }) }}>Не удалось</button>
                      </div>
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
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Салон</th>
                    <th>Заказ</th>
                    <th>Способ оплаты</th>
                    <th>Сумма</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {toCollect.map((d) => (
                    <tr key={d.id}>
                      <td>{d.delivery_address || 'Салон'}</td>
                      <td>{d.items?.[0]?.product_name ? `Заказ · ${d.items[0].product_name}` : 'Заказ'}</td>
                      <td>{d.payment_method === 'bank_transfer' ? 'перевод' : d.payment_method === 'card' ? 'карта' : 'наличные'}</td>
                      <td>{formatMoney(Math.max(0, d.total_minor - (d.amount_collected_minor ?? 0)))}</td>
                      <td>{clientOrderLabel(d.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {toCollect.length === 0 && <p className="muted">Нет заказов с инкассацией</p>}
            {toCollect.map((d) => (
              <article key={`pay-${d.id}`} className="list-item">
                <div className="row between">
                  <strong>{d.delivery_address || 'Салон'}</strong>
                  <button className="btn btn-primary btn-compact" type="button" onClick={() => setActiveId(d.id)}>Отметить оплату</button>
                </div>
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
            <div className="row between"><strong>Получено</strong><strong>{formatMoney(collectedToday)}</strong></div>
            <div className="row between"><strong>Осталось</strong><strong>{formatMoney(pendingToday)}</strong></div>
            <div className="row between"><strong>Итого на день</strong><strong>{formatMoney(toCollect.reduce((s, d) => s + d.total_minor, 0))}</strong></div>
          </section>
          <section className="card stack">
            <h2>Месяц</h2>
            <div className="kpi-grid">
              <article className="card stack-sm"><span className="muted">Получено за месяц</span><strong>{formatMoney(a?.collected_month_minor ?? 0)}</strong></article>
              <article className="card stack-sm"><span className="muted">Ожидается</span><strong>{formatMoney(a?.expected_month_minor ?? 0)}</strong></article>
              <article className="card stack-sm"><span className="muted">Количество заказов</span><strong>{a?.orders_month ?? 0}</strong></article>
              <article className="card stack-sm"><span className="muted">Средняя сумма</span><strong>{formatMoney(a?.average_order_minor ?? 0)}</strong></article>
            </div>
            <div className="dashboard-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={a?.sales_dynamics ?? []}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="period" />
                  <YAxis tickFormatter={(v) => String(Math.round(Number(v) / 100))} />
                  <Tooltip formatter={(v) => formatMoney(Number(v))} />
                  <Area type="monotone" dataKey="collected_minor" stroke={CHART.accent} fill={CHART.accentSoft} name="Собрано" />
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
            <article className="card stack-sm"><span className="muted">Выполнение</span><strong>{Math.round((a?.completion_rate ?? 0) * 100)}%</strong></article>
            <article className="card stack-sm"><span className="muted">Собрано</span><strong>{formatMoney(a?.collected_today_minor ?? 0)}</strong></article>
            <article className="card stack-sm"><span className="muted">Задач закрыто</span><strong>{(tasks.data?.items ?? []).filter((t) => t.status === 'done' || t.status === 'completed').length}</strong></article>
            <article className="card stack-sm"><span className="muted">Просроченные задачи</span><strong>{overdueTasks.length}</strong></article>
          </div>
          <section className="card stack">
            <h2>Доставки по дням</h2>
            <div className="dashboard-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={a?.sales_dynamics ?? []}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="period" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="orders" fill={CHART.gold} name="Доставки" radius={6} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="card stack">
            <h2>Собрано денег</h2>
            <div className="dashboard-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={a?.sales_dynamics ?? []}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="period" />
                  <YAxis tickFormatter={(v) => String(Math.round(Number(v) / 100))} />
                  <Tooltip formatter={(v) => formatMoney(Number(v))} />
                  <Area type="monotone" dataKey="collected_minor" stroke={CHART.accent} fill={CHART.accentSoft} name="Собрано" />
                  <Area type="monotone" dataKey="revenue_minor" stroke={CHART.clay} fill="transparent" name="Продажи" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="card stack">
            <h2>Популярные товары</h2>
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
  if (kind === 'task' || kind === 'work_task') return 'Задача'
  return 'Остановка'
}

function stopStatusLabel(status?: string) {
  if (status === 'done' || status === 'completed') return 'пройдена'
  if (status === 'failed') return 'не удалось'
  if (status === 'en_route') return 'в пути'
  return 'ожидает'
}

function formatWindow(start?: string | null, end?: string | null, eta?: string | null) {
  const fmt = (v?: string | null) => (v ? new Date(v).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '')
  if (start && end) return `${fmt(start)}–${fmt(end)}`
  if (eta) return `ETA ${fmt(eta)}`
  return ''
}
