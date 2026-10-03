/**
 * Touch / pointer approach (dashboard grid):
 * - VIEW (default): dragConfig.enabled=false, resizeConfig.enabled=false; no drag handles
 *   rendered. The page uses touch-action: pan-y so native scroll is never blocked by RGL.
 * - EDIT: dragging ONLY via `.widget-drag-handle` (dragConfig.handle). Handles set
 *   touch-action: none so react-grid-layout can capture the gesture; everything outside
 *   handles keeps pan-y. Unsaved layout edits live in local draft state until Save.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Responsive, useContainerWidth } from 'react-grid-layout'
import type { Layout } from 'react-grid-layout'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import 'react-grid-layout/css/styles.css'
import '@/features/dashboard/dashboard.css'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCabinet } from '@/shared/lib/cabinet'
import { formatMoney } from '@/shared/lib/money'
import { initials } from '@/shared/lib/initials'
import { workTypeLabel } from '@/shared/lib/status'
import { workTypeNeedsSalon } from '@/shared/lib/work-types'
import { masterProfessionLabel } from '@/shared/lib/profession-types'
import { CHART } from '@/shared/ui/chart-theme'
import { AppointmentCard } from '@/shared/ui/AppointmentCard'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { MediaImage } from '@/shared/ui/MediaImage'
import { CalendarPage } from '@/pages/CalendarPage'
import {
  LIBRARY,
  DASHBOARD_BREAKPOINTS,
  DASHBOARD_COLS,
  DASHBOARD_MARGIN,
  applyGridLayout,
  applyPreset,
  breakpointForWidth,
  cloneLayout,
  defaultLayout,
  layoutsEqual,
  makeLayouts,
  normalizeLayout,
  type Breakpoint,
  type WidgetId,
  type WidgetLayout,
} from '@/pages/dashboard-layout'
import { roleTitle } from '@/features/dashboard/roleTitle'
import { premiumLabel } from '@/features/dashboard/premiumLabel'
import type { SupplierOrder } from '@/shared/lib/commerce'

type Appointment = {
  id: string
  service_name: string
  status: string
  starts_at: string
  ends_at?: string
  price_minor: number
  client_user_id?: string
  client_display_name?: string
  master_display_name?: string
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

type MasterHero = {
  display_name?: string
  city?: string
  work_type?: string
  photo_media_id?: string | null
  published?: boolean
  rating_avg?: number
  rating_count?: number
  profession_types?: { id: string; slug: string; name: string }[]
  specializations?: string[]
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
  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 390 })
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(() => breakpointForWidth(390))
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('week')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<WidgetLayout[] | null>(null)

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
  const masterQ = useQuery({
    queryKey: ['me-master-dashboard-hero'],
    queryFn: async () => {
      try {
        return await apiRequest<{ master: MasterHero }>('/v1/me/master', { token: accessToken })
      } catch {
        return { master: {} as MasterHero }
      }
    },
    enabled: Boolean(accessToken && cabinet.kind !== 'client' && cabinet.kind !== 'supplier' && cabinet.kind !== 'supplier_rep'),
    retry: false,
  })

  const rawItems = Array.isArray(layoutQ.data?.widgets) ? layoutQ.data.widgets as Array<Record<string, unknown>> : []
  const calendarPrefs = rawItems.filter((x) => x.id === 'calendar_colors')
  const savedLayout = useMemo(() => normalizeLayout(layoutQ.data?.widgets), [layoutQ.data?.widgets])
  const layout = draft ?? savedLayout
  const relevant = availableWidgets(cabinet)
  const visibleLayout = layout.filter((w) => relevant.some((d) => d.id === w.id))
  const responsiveLayouts = useMemo(() => makeLayouts(visibleLayout), [visibleLayout])
  const dirty = editing && draft != null && !layoutsEqual(draft, savedLayout)

  useEffect(() => {
    if (!editing) setDraft(null)
  }, [editing])

  useEffect(() => {
    setBreakpoint(breakpointForWidth(width))
  }, [width])

  const save = useMutation({
    mutationFn: (widgets: WidgetLayout[]) => apiRequest('/v1/me/dashboard', {
      method: 'PUT',
      token: accessToken,
      body: { widgets: [...widgets, ...calendarPrefs] },
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me-dashboard'] })
      setEditing(false)
      setDraft(null)
    },
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

  const master = masterQ.data?.master
  const displayName = master?.display_name?.trim() || user?.display_name || 'Профиль'
  const city = master?.city?.trim() || user?.city?.trim() || ''
  const workLabel = workTypeLabel(master?.work_type || cabinet.workType)
  const professionLine = master
    ? masterProfessionLabel(master, '')
    : ''
  const salonName = workTypeNeedsSalon(master?.work_type || cabinet.workType)
    ? cabinet.selectedOrg?.organization.name
    : undefined
  const showPortfolio = ['private_master', 'chair_master', 'mobile_master', 'salon_employee', 'salon_owner', 'chain_owner'].includes(cabinet.kind)
  const published = master?.published
  const ratingAvg = typeof master?.rating_avg === 'number' && master.rating_avg > 0 ? master.rating_avg : null
  const ratingCount = typeof master?.rating_count === 'number' ? master.rating_count : 0

  function beginEdit() {
    setDraft(cloneLayout(savedLayout))
    setEditing(true)
  }

  function cancelEdit() {
    if (dirty && !window.confirm('Отменить изменения раскладки?')) return
    setDraft(null)
    setEditing(false)
  }

  function persist(next: WidgetLayout[]) {
    save.mutate(next)
  }

  function patchDraft(next: WidgetLayout[]) {
    setDraft(next)
  }

  function updateLayoutPositions(current: Layout) {
    if (!editing || !draft) return
    setDraft(applyGridLayout(draft, breakpoint, current))
  }

  function setPreset(id: WidgetId, preset: 'compact' | 'wide' | 'large') {
    if (!draft) return
    patchDraft(applyPreset(draft, id, preset))
  }

  function toggleWidget(id: WidgetId, enabled: boolean) {
    if (!draft) return
    const current = draft.find((x) => x.id === id)
    if (!current) {
      const def = LIBRARY.find((d) => d.id === id)
      if (!def) return
      patchDraft([...draft, { id, enabled: true, positions: { lg: def.defaultPosition } }])
      return
    }
    patchDraft(draft.map((x) => x.id === id ? { ...x, enabled } : x))
  }

  return (
    <main className={`page stack dashboard-page${editing ? ' dashboard-page--editing' : ''}`} data-testid="dashboard-page">
      <header className="dashboard-page-head">
        <div className="stack-sm">
          <p className="eyebrow">Главная</p>
          <h1>Сегодня</h1>
          <p className="muted">{roleTitle(cabinet.kind)}</p>
        </div>
        <div
          className="segmented segmented--2 dashboard-mode-toggle"
          role="group"
          aria-label="Режим дашборда"
          data-testid="dashboard-mode-toggle"
        >
          <label className={!editing ? 'is-active' : undefined}>
            <input
              type="radio"
              name="dashboard-mode"
              checked={!editing}
              data-testid="dashboard-view"
              onChange={() => {
                if (editing) cancelEdit()
              }}
            />
            Просмотр
          </label>
          <label className={editing ? 'is-active' : undefined}>
            <input
              type="radio"
              name="dashboard-mode"
              checked={editing}
              data-testid="dashboard-edit"
              onChange={() => {
                if (!editing) beginEdit()
              }}
            />
            Редактирование
          </label>
        </div>
      </header>
      {editing && (
        <p className="dashboard-edit-hint muted" data-testid="dashboard-edit-active" role="status">
          Режим редактирования — можно менять размер и расположение виджетов
        </p>
      )}

      {/* 1. Profile hero */}
      <section className="dash-profile-hero" data-testid="dashboard-hero" aria-label="Профиль">
        <div className="dash-profile-hero__photo" aria-hidden={!master?.photo_media_id}>
          {master?.photo_media_id ? (
            <MediaImage mediaId={master.photo_media_id} token={accessToken} alt={displayName} fallback={initials(displayName)} variant="cover" />
          ) : (
            <div className="media-fallback" role="img" aria-label={displayName}>{initials(displayName)}</div>
          )}
          <div className="dash-profile-hero__fade" />
        </div>
        <div className="dash-profile-hero__body">
          <h2 className="dash-profile-hero__name">{displayName}</h2>
          <p className="dash-profile-hero__role">
            {workLabel}
            {professionLine ? ` · ${professionLine}` : ''}
          </p>
          {professionLine && (master?.profession_types?.length ?? 0) > 0 && (
            <div className="dash-profile-hero__chips">
              {master!.profession_types!.slice(0, 4).map((t) => (
                <span key={t.id} className="chip">{t.name}</span>
              ))}
            </div>
          )}
          <ul className="dash-profile-hero__facts">
            {city && <li>{city}</li>}
            {salonName && <li><strong>{salonName}</strong></li>}
            {ratingAvg != null && (
              <li>★ {ratingAvg.toFixed(1)}{ratingCount > 0 ? ` (${ratingCount})` : ''}</li>
            )}
            {appointments.isFetched && <li>Сегодня: <strong>{today.length}</strong></li>}
          </ul>
          <div className="dash-profile-hero__meta">
            <Link className="dash-premium-pill" to="/profile/subscription" data-testid="dashboard-premium-pill">
              {premiumLabel(sub.data)}
            </Link>
            {typeof published === 'boolean' && (
              <span className={`dash-visibility${published ? ' dash-visibility--on' : ''}`} data-testid="dashboard-visibility">
                <span className="dash-visibility__dot" aria-hidden="true" />
                {published ? 'В поиске' : 'Скрыт'}
              </span>
            )}
          </div>
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
      </section>

      {/* 2. Key actions */}
      <nav className="dash-key-actions" aria-label="Быстрые действия" data-testid="dashboard-key-actions">
        {cabinet.can('calendar') && <Link className="btn btn-secondary" to="/calendar">Календарь</Link>}
        <Link className="btn btn-secondary" to="/appointments">Записи</Link>
        {cabinet.can('clients') && <Link className="btn btn-secondary" to="/clients">Клиенты</Link>}
        {cabinet.can('services') && <Link className="btn btn-secondary" to="/services">Услуги</Link>}
        <Link className="btn btn-secondary" to="/messages">Сообщения</Link>
        {showPortfolio && <Link className="btn btn-secondary" to="/portfolio">Портфолио</Link>}
      </nav>

      {editing && draft && (
        <div className="dash-edit-bar" data-testid="dashboard-edit-bar">
          <div className="dash-edit-bar__actions">
            <button
              className={`btn btn-primary${save.isPending ? ' btn-loading' : ''}`}
              type="button"
              data-testid="dashboard-save"
              disabled={save.isPending || !dirty}
              onClick={() => persist(draft)}
            >
              Сохранить
            </button>
            <button className="btn btn-secondary" type="button" data-testid="dashboard-cancel" onClick={cancelEdit}>
              Отменить
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              data-testid="dashboard-reset"
              onClick={() => patchDraft(defaultLayout())}
            >
              Сбросить по умолчанию
            </button>
          </div>
          <div className="dash-edit-toggles">
            {relevant.map((def) => {
              const current = draft.find((x) => x.id === def.id)
              return (
                <article key={def.id} className="dash-edit-row">
                  <label className="field-check">
                    <input
                      type="checkbox"
                      checked={current?.enabled === true}
                      onChange={(e) => toggleWidget(def.id, e.target.checked)}
                    />
                    <span><strong>{def.title}</strong></span>
                  </label>
                  <div className="chip-row compact">
                    {([['compact', 'Компакт'], ['wide', 'Широкий'], ['large', 'Большой']] as const).map(([id, label]) => (
                      <button key={id} className="chip" type="button" disabled={!current?.enabled} onClick={() => setPreset(def.id, id)}>{label}</button>
                    ))}
                  </div>
                </article>
              )
            })}
          </div>
          {save.isError && <ErrorBanner error={save.error} fallbackTitle="Не удалось сохранить раскладку" />}
        </div>
      )}

      {layoutQ.isLoading && (
        <div className="list">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      )}

      {/* 3. Operational widgets · 4. analytics last */}
      <div ref={containerRef} className="dashboard-grid-container" data-testid="dashboard-grid">
        {mounted && (
          <Responsive<Breakpoint>
            width={width}
            layouts={responsiveLayouts}
            breakpoints={DASHBOARD_BREAKPOINTS}
            cols={DASHBOARD_COLS}
            rowHeight={36}
            margin={DASHBOARD_MARGIN}
            dragConfig={{
              enabled: editing,
              handle: '.widget-drag-handle',
              cancel: 'a,button,input,select,.widget-content',
            }}
            resizeConfig={{
              enabled: editing,
              handles: editing ? ['se'] : [],
            }}
            onBreakpointChange={(next) => setBreakpoint(next as Breakpoint)}
            onDragStop={(next) => updateLayoutPositions(next)}
            onResizeStop={(next) => updateLayoutPositions(next)}
          >
            {visibleLayout.filter((w) => w.enabled).map((w) => (
              <section
                key={w.id}
                className={`dash-widget${w.id === 'analytics' ? ' dash-widget--analytics' : ''}`}
                data-widget={w.id}
              >
                {editing && (
                  <div className="widget-drag-handle" data-testid={`drag-handle-${w.id}`}>
                    <span>{LIBRARY.find((d) => d.id === w.id)?.title}</span>
                    <span aria-hidden="true">⠿</span>
                  </div>
                )}
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
                  {w.id === 'messages' && <MetricTile label="Сообщения" value={unread.length} caption="непрочитанных" to="/messages" />}
                  {w.id === 'upcoming' && (
                    <div className="stack">
                      <div className="row between"><h2>Ближайшие записи</h2><Link to="/appointments">Все</Link></div>
                      {upcoming.length === 0 && <p className="muted">Нет ближайших записей</p>}
                      {upcoming.map((a) => (
                        <AppointmentCard
                          key={a.id}
                          to={`/appointments/${a.id}`}
                          serviceName={a.service_name}
                          personName={a.client_display_name}
                          subtitle={a.master_display_name}
                          status={a.status}
                          startsAt={a.starts_at}
                          priceMinor={a.price_minor}
                        />
                      ))}
                    </div>
                  )}
                  {w.id === 'analytics' && (
                    <div className="stack analytics-widget" data-testid="dashboard-analytics">
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
                          <AreaChart data={chartData}><defs><linearGradient id="visitsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={CHART.accent} stopOpacity={0.35}/><stop offset="100%" stopColor={CHART.accent} stopOpacity={0.02}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART.grid}/><XAxis dataKey="day" tick={{ fontSize: 11, fill: CHART.text }}/><YAxis allowDecimals={false} width={24} tick={{ fill: CHART.text }}/><Tooltip contentStyle={{ background: CHART.surface, border: `1px solid ${CHART.surface2}`, color: CHART.tooltipText }}/><Area type="monotone" dataKey="visits" name="Записи" stroke={CHART.accent} fill="url(#visitsFill)"/></AreaChart>
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
