import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Responsive, useContainerWidth } from 'react-grid-layout'
import type { Layout } from 'react-grid-layout'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import 'react-grid-layout/css/styles.css'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCabinet } from '@/shared/lib/cabinet'
import { formatMoney } from '@/shared/lib/money'
import { statusBadgeClass, statusLabel } from '@/shared/lib/status'
import { Hint } from '@/shared/ui/Hint'
import { CHART } from '@/shared/ui/chart-theme'
import { tokens } from '@/shared/ui/tokens'
import { CalendarPage } from '@/pages/CalendarPage'
import { LIBRARY, makeLayouts, normalizeLayout, type Breakpoint, type WidgetId, type WidgetLayout } from '@/pages/dashboard-layout'
import type { SupplierOrder } from '@/shared/lib/commerce'

type Appointment = {
  id: string
  service_name: string
  status: string
  starts_at: string
  ends_at?: string
  price_minor: number
  client_user_id?: string
  branch_id?: string
}

type Notification = {
  id: string
  title: string
  body: string
  entity_type?: string
  entity_id?: string | null
  read_at: string | null
  created_at: string
}

type PlannerTask = { id: string; title: string; starts_at: string; category: string }

type SalonReport = {
  current: {
    turnover_minor: number
    completed_count: number
    master_load_percent?: number | null
    repeat_visit_percent?: number | null
  }
}

function notificationHref(n: Notification) {
  if (n.entity_type === 'appointment' && n.entity_id) return `/appointments/${n.entity_id}`
  if (n.entity_type === 'conversation' && n.entity_id) return `/messages/${n.entity_id}`
  if (n.entity_type === 'masterclass' && n.entity_id) return `/masterclasses/${n.entity_id}`
  if (n.entity_type === 'model_request' && n.entity_id) return `/models/${n.entity_id}`
  return '/notifications'
}

function periodStartIso(period: 'today' | 'week' | 'month') {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  if (period === 'week') start.setDate(start.getDate() - 6)
  if (period === 'month') start.setDate(start.getDate() - 29)
  return start.toISOString()
}

function availableWidgets(cabinet: ReturnType<typeof useCabinet>) {
  return LIBRARY.filter((w) => {
    if (w.id === 'orders') return cabinet.can('cosmetics')
    if (w.id === 'deliveries') return cabinet.can('cosmetics') || cabinet.kind === 'salon_owner' || cabinet.kind === 'chain_owner'
    return true
  })
}

export function DashboardPage() {
  const { user, accessToken } = useAuth()
  const cabinet = useCabinet()
  const qc = useQueryClient()
  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 1200 })
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [breakpoint, setBreakpoint] = useState<Breakpoint>('lg')
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('week')

  const layoutQ = useQuery({
    queryKey: ['me-dashboard'],
    queryFn: () => apiRequest<{ widgets: unknown }>('/v1/me/dashboard', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const sub = useQuery({
    queryKey: ['me-subscription'],
    queryFn: () =>
      apiRequest<{ status: string; trial_ends_at?: string; effective_plan: string }>('/v1/me/subscription', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const rawItems = Array.isArray(layoutQ.data?.widgets) ? layoutQ.data.widgets as Array<Record<string, unknown>> : []
  const calendarPrefs = rawItems.filter((x) => x.id === 'calendar_colors')
  const layout = useMemo(() => normalizeLayout(layoutQ.data?.widgets), [layoutQ.data?.widgets])
  const relevant = availableWidgets(cabinet)
  const visibleLayout = layout.filter((w) => relevant.some((d) => d.id === w.id))
  const responsiveLayouts = useMemo(() => makeLayouts(visibleLayout), [visibleLayout])

  const save = useMutation({
    mutationFn: (widgets: WidgetLayout[]) => apiRequest('/v1/me/dashboard', {
      method: 'PUT',
      token: accessToken,
      body: { widgets: [...widgets, ...calendarPrefs] },
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me-dashboard'] }),
  })

  const ownerMode = ['salon_owner', 'chain_owner', 'salon_admin'].includes(cabinet.kind)
  const orgID = cabinet.selectedOrg?.organization.id
  const rangeFrom = new Date()
  rangeFrom.setDate(rangeFrom.getDate() - 30)
  const rangeTo = new Date()
  rangeTo.setDate(rangeTo.getDate() + 14)
  const fromISO = rangeFrom.toISOString()
  const toISO = rangeTo.toISOString()

  const appointments = useQuery({
    queryKey: ['home-appointments', ownerMode, orgID, fromISO, toISO],
    queryFn: () => ownerMode && orgID
      ? apiRequest<{ items: Appointment[] }>(`/v1/calendar/appointments?organization_id=${orgID}&from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`, { token: accessToken })
      : apiRequest<{ items: Appointment[] }>(`/v1/appointments/mine?role=master&from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`, { token: accessToken }),
    enabled: Boolean(accessToken && (!ownerMode || orgID)),
  })
  const notes = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiRequest<{ items: Notification[] }>('/v1/notifications', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const markRead = useMutation({
    mutationFn: (id: string) => apiRequest(`/v1/notifications/${id}/read`, { method: 'POST', token: accessToken }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const tasks = useQuery({
    queryKey: ['dashboard-tasks', fromISO, toISO, ownerMode ? orgID : ''],
    queryFn: () => apiRequest<{ items: PlannerTask[] }>(
      `/v1/planner/blocks?from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}${ownerMode && orgID ? `&organization_id=${orgID}` : ''}`,
      { token: accessToken },
    ),
    enabled: Boolean(accessToken && (!ownerMode || orgID)),
  })
  const orders = useQuery({
    queryKey: ['dashboard-orders', orgID],
    queryFn: () => apiRequest<{ items: SupplierOrder[] }>(`/v1/commerce/supplier-orders?organization_id=${orgID}`, { token: accessToken }),
    enabled: Boolean(accessToken && orgID && (cabinet.can('cosmetics') || cabinet.kind === 'salon_owner' || cabinet.kind === 'chain_owner')),
  })
  const report = useQuery({
    queryKey: ['dashboard-salon-report', orgID, period],
    queryFn: () => apiRequest<SalonReport>(
      `/v1/reports/salon?organization_id=${orgID}&from=${encodeURIComponent(periodStartIso(period))}&to=${encodeURIComponent(new Date().toISOString())}`,
      { token: accessToken },
    ),
    enabled: Boolean(accessToken && orgID && cabinet.can('reports')),
  })

  const items = (appointments.data?.items ?? []).filter((a) => {
    if (cabinet.kind !== 'chain_owner' || !cabinet.selectedBranch?.id) return true
    return !a.branch_id || a.branch_id === cabinet.selectedBranch.id
  })
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const endOfToday = new Date(startOfToday)
  endOfToday.setDate(endOfToday.getDate() + 1)
  const today = items.filter((a) => {
    const at = new Date(a.starts_at)
    return at >= startOfToday && at < endOfToday
  })
  const pending = items.filter((a) => a.status === 'pending_confirmation')
  const cancellations = items.filter((a) => a.status.startsWith('cancelled_')).slice(0, 3)
  const upcoming = [...items]
    .filter((a) => ['pending_confirmation', 'confirmed', 'in_progress'].includes(a.status) && new Date(a.starts_at) >= startOfToday)
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
    .slice(0, 5)
  const unread = (notes.data?.items ?? []).filter((n) => !n.read_at).slice(0, 5)

  const periodStart = new Date(startOfToday)
  if (period === 'week') periodStart.setDate(periodStart.getDate() - 6)
  if (period === 'month') periodStart.setDate(periodStart.getDate() - 29)
  const periodItems = items.filter((a) => new Date(a.starts_at) >= periodStart && new Date(a.starts_at) < endOfToday)
  const completed = periodItems.filter((a) => a.status === 'completed')
  const uniqueClients = new Set(periodItems.map((a) => a.client_user_id).filter(Boolean)).size
  const bookedMinutes = periodItems.reduce((sum, a) => {
    if (!a.ends_at) return sum
    return sum + Math.max(0, (new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000)
  }, 0)
  const periodDays = period === 'today' ? 1 : period === 'week' ? 7 : 30
  const load = Math.min(100, Math.round(bookedMinutes / (periodDays * 9 * 60) * 100))
  const serviceCounts = Object.entries(periodItems.reduce<Record<string, number>>((acc, a) => {
    acc[a.service_name] = (acc[a.service_name] ?? 0) + 1
    return acc
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 3)
  const chartData = Array.from({ length: periodDays }, (_, offset) => {
    const date = new Date(periodStart)
    date.setDate(date.getDate() + offset)
    const key = date.toISOString().slice(0, 10)
    return {
      day: date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }),
      visits: periodItems.filter((a) => a.starts_at.slice(0, 10) === key).length,
    }
  })

  function updateLayout(current: Layout) {
    const next = layout.map((widget) => {
      const pos = current.find((item) => item.i === widget.id)
      if (!pos) return widget
      return {
        ...widget,
        positions: {
          ...widget.positions,
          [breakpoint]: { x: pos.x, y: pos.y, w: pos.w, h: pos.h },
        },
      }
    })
    save.mutate(next)
  }

  function patchLayout(next: WidgetLayout[]) {
    save.mutate(next)
  }

  function setPreset(id: WidgetId, preset: 'compact' | 'wide' | 'large') {
    const dims = preset === 'compact' ? { w: 3, h: 4 } : preset === 'wide' ? { w: 6, h: 6 } : { w: 12, h: id === 'calendar' ? 18 : 9 }
    patchLayout(layout.map((w) => w.id === id ? {
      ...w,
      positions: { ...w.positions, lg: { ...(w.positions.lg ?? LIBRARY.find((d) => d.id === id)!.defaultPosition), ...dims } },
    } : w))
  }

  return (
    <main className="page stack dashboard-page">
      <div className="dashboard-head">
        <div className="stack-sm">
          <p className="eyebrow">{cabinet.label}</p>
          <h1>Сегодня, {user?.display_name}</h1>
          <p className="muted">
            {cabinet.kind === 'chain_owner' && cabinet.selectedBranch
              ? `${cabinet.selectedOrg?.organization.name ?? 'Сеть'} · ${cabinet.selectedBranch.name}. `
              : ''}
            Важное и расписание на одном экране.
            <Hint id="dash-layout" title="Ваш рабочий стол">Перетаскивайте карточки за заголовок и меняйте их размер за угол. Раскладка сохраняется автоматически.</Hint>
          </p>
          {cabinet.kind === 'chain_owner' && (cabinet.selectedOrg?.branches.length ?? 0) > 1 && (
            <label className="field" style={{ maxWidth: 280 }}>
              <span className="muted">Филиал</span>
              <select
                aria-label="Филиал"
                value={cabinet.selectedBranch?.id ?? ''}
                onChange={(e) => cabinet.setSelectedBranchId(e.target.value)}
              >
                {(cabinet.selectedOrg?.branches ?? []).map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <button className="btn btn-secondary" type="button" onClick={() => setLibraryOpen(true)}>Настроить</button>
      </div>
      {sub.data?.status === 'trial' && sub.data.trial_ends_at && (
        <section className="card stack-sm trial-banner">
          <h2>Premium активирован бесплатно на 3 месяца</h2>
          <p>До {new Date(sub.data.trial_ends_at).toLocaleDateString('ru-RU')} · <Link to="/profile/subscription">Подписка</Link></p>
        </section>
      )}

      <div ref={containerRef} className="dashboard-grid-container">
        {mounted && (
          <Responsive<Breakpoint>
            width={width}
            layouts={responsiveLayouts}
            breakpoints={{ lg: 1200, md: 768, sm: 480, xs: 0 }}
            cols={{ lg: 12, md: 8, sm: 4, xs: 1 }}
            rowHeight={36}
            margin={{ lg: [18, 18], md: [14, 14], sm: [12, 12], xs: [10, 10] }}
            dragConfig={{ handle: '.widget-drag-handle', cancel: 'a,button,input,select' }}
            resizeConfig={{ handles: ['se'] }}
            onBreakpointChange={(next) => setBreakpoint(next)}
            onDragStop={(next) => updateLayout(next)}
            onResizeStop={(next) => updateLayout(next)}
          >
            {visibleLayout.filter((w) => w.enabled).map((w) => (
              <section key={w.id} className="dash-widget">
                <div className="widget-drag-handle"><span>{LIBRARY.find((d) => d.id === w.id)?.title}</span><span aria-hidden="true">⠿</span></div>
                <div className="widget-content">
                  {w.id === 'alerts' && (
                    <div className="stack">
                      <div className="row between"><h2>Важное</h2><Link to="/notifications">Все уведомления</Link></div>
                      {unread.length === 0 && pending.length === 0 && cancellations.length === 0 && <div className="dashboard-calm-state">Всё спокойно — срочных действий нет</div>}
                      <div className="important-grid">
                        {pending.map((a) => <Link key={a.id} to={`/appointments/${a.id}`} className="important-item warning"><span>Требует ответа</span><strong>{a.service_name}</strong><small>{new Date(a.starts_at).toLocaleString('ru-RU')}</small></Link>)}
                        {cancellations.map((a) => <Link key={a.id} to={`/appointments/${a.id}`} className="important-item danger"><span>Отмена</span><strong>{a.service_name}</strong><small>{new Date(a.starts_at).toLocaleString('ru-RU')}</small></Link>)}
                        {unread.map((n) => (
                          <Link key={n.id} to={notificationHref(n)} className="important-item">
                            <span>Сообщение</span>
                            <strong>{n.title}</strong>
                            <small>{n.body}</small>
                            {!n.read_at && (
                              <button className="btn btn-secondary btn-compact" type="button" onClick={(e) => { e.preventDefault(); markRead.mutate(n.id) }}>
                                Прочитано
                              </button>
                            )}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                  {w.id === 'calendar' && <CalendarPage embedded />}
                  {w.id === 'today' && <MetricTile label="Сегодня" value={today.length} caption="записей" to="/calendar" />}
                  {w.id === 'pending' && <MetricTile label="Ожидают" value={pending.length} caption="подтверждения" to="/appointments" />}
                  {w.id === 'clients_today' && <MetricTile label="Клиенты сегодня" value={new Set(today.map((a) => a.client_user_id).filter(Boolean)).size || today.length} caption="человек" to="/clients" />}
                  {w.id === 'messages' && <MetricTile label="Сообщения" value={unread.length} caption="непрочитанных" to="/notifications" />}
                  {w.id === 'upcoming' && (
                    <div className="stack">
                      <div className="row between"><h2>Ближайшие записи</h2><Link to="/appointments">Все</Link></div>
                      {upcoming.length === 0 && <p className="muted">Нет ближайших записей</p>}
                      {upcoming.map((a) => (
                        <Link key={a.id} to={`/appointments/${a.id}`} className="appointment-row">
                          <time>{new Date(a.starts_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time>
                          <div><strong>{a.service_name}</strong><span>{new Date(a.starts_at).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })}</span></div>
                          <span className={`badge ${statusBadgeClass(a.status)}`}>{statusLabel(a.status)}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                  {w.id === 'analytics' && (
                    <div className="stack analytics-widget">
                      <div className="row between">
                        <h2>{cabinet.can('reports') ? 'Сводка салона' : 'Моя статистика'}</h2>
                        <div className="chip-row compact">{(['today', 'week', 'month'] as const).map((p) => <button key={p} className={`chip ${period === p ? 'active' : ''}`} type="button" onClick={() => setPeriod(p)}>{p === 'today' ? 'Сегодня' : p === 'week' ? 'Неделя' : 'Месяц'}</button>)}</div>
                      </div>
                      <div className="analytics-kpis">
                        <div><span>Записи</span><strong>{cabinet.can('reports') ? (report.data?.current.completed_count ?? periodItems.length) : periodItems.length}</strong></div>
                        <div><span>Клиенты</span><strong>{uniqueClients || periodItems.length}</strong></div>
                        <div><span>Загрузка</span><strong>{cabinet.can('reports') && report.data?.current.master_load_percent != null ? `${Math.round(report.data.current.master_load_percent)}%` : `${load}%`}</strong></div>
                        <div><span>Выручка</span><strong>{cabinet.can('reports') ? formatMoney(report.data?.current.turnover_minor ?? 0) : formatMoney(completed.reduce((sum, a) => sum + a.price_minor, 0))}</strong></div>
                      </div>
                      <div className="dashboard-chart">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={chartData}><defs><linearGradient id="visitsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={CHART.accent} stopOpacity={0.35}/><stop offset="100%" stopColor={CHART.accent} stopOpacity={0.02}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART.grid}/><XAxis dataKey="day" tick={{ fontSize: 11, fill: CHART.text }}/><YAxis allowDecimals={false} width={24} tick={{ fill: CHART.text }}/><Tooltip contentStyle={{ background: tokens.color.surface, border: `1px solid ${tokens.color.surface2}`, color: tokens.color.textPrimary }}/><Area type="monotone" dataKey="visits" name="Записи" stroke={CHART.accent} fill="url(#visitsFill)"/></AreaChart>
                        </ResponsiveContainer>
                      </div>
                      {serviceCounts.length > 0 && <p className="muted">Популярное: {serviceCounts.map(([name, count]) => `${name} · ${count}`).join('  |  ')}</p>}
                      {cabinet.can('reports') && <Link to="/reports">Подробная аналитика →</Link>}
                    </div>
                  )}
                  {w.id === 'tasks' && (
                    <div className="stack">
                      <div className="row between"><h2>Задачи</h2><Link to="/calendar">Календарь</Link></div>
                      {(tasks.data?.items ?? []).filter((b) => b.category === 'task').length === 0 && <EmptyWidget title="Задачи" text="Просроченных задач нет" />}
                      {(tasks.data?.items ?? []).filter((b) => b.category === 'task').slice(0, 5).map((b) => (
                        <Link key={b.id} to="/calendar" className="appointment-row">
                          <time>{new Date(b.starts_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time>
                          <div><strong>{b.title}</strong></div>
                        </Link>
                      ))}
                    </div>
                  )}
                  {w.id === 'orders' && (
                    <MetricTile
                      label="Заказы"
                      value={(orders.data?.items ?? []).filter((o) => !['delivered', 'cancelled'].includes(o.status)).length}
                      caption="открытых"
                      to="/cosmetics/orders"
                    />
                  )}
                  {w.id === 'deliveries' && (
                    <MetricTile
                      label="Доставки"
                      value={(orders.data?.items ?? []).filter((o) => ['in_transit', 'ready_for_dispatch', 'preparing'].includes(o.status)).length}
                      caption="в пути / сборке"
                      to="/cosmetics/orders"
                    />
                  )}
                </div>
              </section>
            ))}
          </Responsive>
        )}
      </div>

      {libraryOpen && (
        <div className="more-drawer" role="dialog" aria-modal="true" onClick={() => setLibraryOpen(false)}>
          <div className="more-panel stack dashboard-settings" onClick={(e) => e.stopPropagation()}>
            <div className="row between"><div><p className="eyebrow">Рабочий стол</p><h2>Настроить dashboard</h2></div><button className="btn btn-secondary btn-compact" type="button" onClick={() => setLibraryOpen(false)}>Готово</button></div>
            <p className="muted">Выберите нужные блоки. Порядок и размер также можно менять прямо на рабочем столе.</p>
            {relevant.map((def) => {
              const current = layout.find((x) => x.id === def.id)
              return (
                <article key={def.id} className="dashboard-setting-row">
                  <label className="field-check">
                    <input
                      type="checkbox"
                      checked={current?.enabled === true}
                      onChange={(e) => {
                        if (!current) {
                          patchLayout([...layout, { id: def.id, enabled: true, positions: { lg: def.defaultPosition } }])
                        } else {
                          patchLayout(layout.map((x) => x.id === def.id ? { ...x, enabled: e.target.checked } : x))
                        }
                      }}
                    />
                    <span><strong>{def.title}</strong></span>
                  </label>
                  <div className="chip-row compact">
                    {([['compact', 'Компакт'], ['wide', 'Широкий'], ['large', 'Большой']] as const).map(([id, label]) => <button key={id} className="chip" type="button" disabled={!current?.enabled} onClick={() => setPreset(def.id, id)}>{label}</button>)}
                  </div>
                </article>
              )
            })}
            {save.isError && <div className="state-box error">{save.error instanceof ApiError ? save.error.message : 'Не удалось сохранить раскладку'}</div>}
          </div>
        </div>
      )}
    </main>
  )
}

function MetricTile({ label, value, caption, to }: { label: string; value: number; caption: string; to: string }) {
  return <Link className="dashboard-metric" to={to}><span>{label}</span><strong>{value}</strong><small>{caption}</small></Link>
}

function EmptyWidget({ title, text, to }: { title: string; text: string; to?: string }) {
  const body = <><span className="empty-widget-icon">✓</span><h2>{title}</h2><p className="muted">{text}</p></>
  return to ? <Link className="empty-widget" to={to}>{body}</Link> : <div className="empty-widget">{body}</div>
}
