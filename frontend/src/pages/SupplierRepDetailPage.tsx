import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { apiRequest } from '@/shared/api/client'
import { formatUserError } from '@/shared/lib/app-error'
import { useAuth } from '@/features/auth/AuthProvider'
import { useSupplierOrg } from '@/shared/lib/commerce'
import { formatMoney } from '@/shared/lib/money'
import { CalendarPage } from '@/pages/CalendarPage'
import { CHART } from '@/shared/ui/chart-theme'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'

type Rep = {
  id: string
  display_name?: string
  email?: string
  city?: string
  territory?: string
  active?: boolean
  user_id?: string
  tasks_today?: number
  tasks_done?: number
  tasks_overdue?: number
}

type Task = { id: string; title: string; status: string; kind?: string; due_at?: string; priority?: string }
type Delivery = { id: string; status: string; delivery_address?: string; total_minor: number; rep_user_id?: string }
type RouteStop = { id: string; kind: string; status: string; sort_order: number; eta_at?: string }

const TABS = [
  { id: 'dashboard', label: 'Дашборд' },
  { id: 'calendar', label: 'Календарь' },
  { id: 'tasks', label: 'Задачи' },
  { id: 'deliveries', label: 'Доставки' },
  { id: 'route', label: 'Маршрут' },
  { id: 'finance', label: 'Финансы' },
  { id: 'analytics', label: 'Аналитика' },
] as const

export function SupplierRepDetailPage() {
  const { id } = useParams()
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const { supplierOrgId, orgs } = useSupplierOrg()
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('dashboard')
  const [error, setError] = useState<string | null>(null)

  const reps = useQuery({
    queryKey: ['supplier-reps', supplierOrgId],
    queryFn: () => apiRequest<{ items: Rep[] }>(`/v1/organizations/${supplierOrgId}/representatives`, { token: accessToken }),
    enabled: Boolean(accessToken && supplierOrgId),
  })
  const rep = (reps.data?.items ?? []).find((r) => r.id === id)
  const tasks = useQuery({
    queryKey: ['supplier-tasks', supplierOrgId, id],
    queryFn: () => apiRequest<{ items: Task[] }>(`/v1/organizations/${supplierOrgId}/tasks?representative_id=${id}`, { token: accessToken }),
    enabled: Boolean(accessToken && supplierOrgId && id),
  })
  const deliveries = useQuery({
    queryKey: ['rep-deliveries-admin', supplierOrgId],
    queryFn: () => apiRequest<{ items: Delivery[] }>(`/v1/commerce/rep/deliveries?organization_id=${supplierOrgId}`, { token: accessToken }),
    enabled: Boolean(accessToken && supplierOrgId),
  })
  const routes = useQuery({
    queryKey: ['rep-routes', supplierOrgId],
    queryFn: () => apiRequest<{ items: Array<{ total_km?: number; total_minutes?: number; stops?: RouteStop[]; label?: string }> }>(`/v1/organizations/${supplierOrgId}/routes`, { token: accessToken }),
    enabled: Boolean(accessToken && supplierOrgId),
  })
  const analytics = useQuery({
    queryKey: ['supplier-analytics-team', supplierOrgId],
    queryFn: () => apiRequest<{ representatives?: Array<{ user_id: string; collected_minor: number; remaining_minor: number; orders: number; unfinished_deliveries?: number; deliveries_today?: number }> }>(
      `/v1/commerce/supplier/analytics?organization_id=${supplierOrgId}&period=month`,
      { token: accessToken },
    ),
    enabled: Boolean(accessToken && supplierOrgId),
  })

  const startTask = useMutation({
    mutationFn: (taskId: string) => apiRequest(`/v1/tasks/${taskId}/status`, { token: accessToken, body: { status: 'in_progress' } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplier-tasks'] }),
    onError: (e) => setError(formatUserError(e, 'Не удалось обновить задачу')),
  })

  const stats = (analytics.data?.representatives ?? []).find((x) => x.user_id === rep?.user_id)
  const route = routes.data?.items[0]
  const stops = useMemo(() => [...(route?.stops ?? [])].sort((a, b) => a.sort_order - b.sort_order), [route])
  const pendingDeliveries = (deliveries.data?.items ?? []).filter((d) =>
    (d.status === 'in_delivery' || d.status === 'confirmed' || d.status === 'picking') &&
    (!rep?.user_id || !d.rep_user_id || d.rep_user_id === rep.user_id),
  )

  if (orgs.isLoading || reps.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>
  if (!rep) return <main className="page"><div className="empty-state"><h2>Представитель не найден</h2><Link to="/supplier/team">К списку</Link></div></main>

  const name = rep.display_name || rep.email || rep.city || 'Представитель'

  return (
    <main className="page stack">
      <div className="row between">
        <div className="stack-sm">
          <Link to="/supplier/team">← Представители</Link>
          <h1>{name}</h1>
          <p className="muted">{[rep.city, rep.territory, rep.email].filter(Boolean).join(' · ')}</p>
        </div>
        <span className={`badge ${rep.active === false ? 'badge-default' : 'badge-success'}`}>{rep.active === false ? 'Неактивен' : 'Активен'}</span>
      </div>
      {error && <ErrorBanner error={error} />}
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === 'dashboard' && (
        <>
          <div className="kpi-grid">
            <article className="card stack-sm"><span className="muted">Задач сегодня</span><strong>{rep.tasks_today ?? 0}</strong></article>
            <article className="card stack-sm"><span className="muted">Доставок сегодня</span><strong>{stats?.deliveries_today ?? 0}</strong></article>
            <article className="card stack-sm"><span className="muted">Выполнено</span><strong>{rep.tasks_done ?? 0}</strong></article>
            <article className="card stack-sm"><span className="muted">Просрочено</span><strong>{rep.tasks_overdue ?? 0}</strong></article>
            <article className="card stack-sm"><span className="muted">Собрано</span><strong>{formatMoney(stats?.collected_minor ?? 0)}</strong></article>
            <article className="card stack-sm"><span className="muted">К получению</span><strong>{formatMoney(stats?.remaining_minor ?? 0)}</strong></article>
          </div>
          <section className="card stack">
            <h2>Открытые задачи</h2>
            {(tasks.data?.items ?? []).filter((t) => t.status !== 'done' && t.status !== 'cancelled').slice(0, 5).map((t) => (
              <article key={t.id} className="list-item row between">
                <strong>{t.title}</strong>
                <span>{t.status}</span>
              </article>
            ))}
          </section>
        </>
      )}

      {tab === 'calendar' && <CalendarPage embedded overlayRepId={rep.id} />}

      {tab === 'tasks' && (
        <section className="card stack">
          <h2>Задачи</h2>
          {(tasks.data?.items ?? []).length === 0 && <p className="muted">Нет задач</p>}
          {(tasks.data?.items ?? []).map((t) => (
            <article key={t.id} className="list-item row between">
              <div>
                <strong>{t.title}</strong>
                <p className="muted">{t.kind} · {t.priority} · {t.due_at ? new Date(t.due_at).toLocaleString('ru-RU') : 'без срока'}</p>
              </div>
              <div className="row">
                <span>{t.status}</span>
                {t.status === 'open' && <button className="btn btn-secondary btn-compact" type="button" onClick={() => startTask.mutate(t.id)}>Начать</button>}
              </div>
            </article>
          ))}
        </section>
      )}

      {tab === 'deliveries' && (
        <section className="card stack">
          <h2>Доставки</h2>
          {pendingDeliveries.length === 0 && <p className="muted">Нет активных доставок</p>}
          {pendingDeliveries.map((d) => (
            <article key={d.id} className="list-item row between">
              <div>
                <strong>{d.delivery_address || 'Салон'}</strong>
                <p className="muted">{d.status}</p>
              </div>
              <span>{formatMoney(d.total_minor)}</span>
            </article>
          ))}
        </section>
      )}

      {tab === 'route' && (
        <section className="card stack">
          <h2>Маршрут</h2>
          <p className="muted">{route ? `${route.label || 'Рекомендованный маршрут'} · ${Number(route.total_km ?? 0).toFixed(1)} км · ${route.total_minutes ?? '—'} мин` : 'Маршрут не построен'}</p>
          <ol className="list">
            {stops.map((s, i) => (
              <li key={s.id} className="list-item">{i + 1}. {s.kind} · {s.status}{s.eta_at ? ` · ${new Date(s.eta_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ''}</li>
            ))}
          </ol>
        </section>
      )}

      {tab === 'finance' && (
        <section className="card stack">
          <h2>Финансы</h2>
          <p>Собрано: {formatMoney(stats?.collected_minor ?? 0)}</p>
          <p>Ожидается: {formatMoney(stats?.remaining_minor ?? 0)}</p>
          <p>Заказов: {stats?.orders ?? 0}</p>
        </section>
      )}

      {tab === 'analytics' && (
        <section className="card stack">
          <h2>Аналитика представителя</h2>
          <div className="dashboard-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[{ name: 'Собрано', value: stats?.collected_minor ?? 0 }, { name: 'Ожидается', value: stats?.remaining_minor ?? 0 }]}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" />
                <YAxis tickFormatter={(v) => String(Math.round(Number(v) / 100))} />
                <Tooltip formatter={(v) => formatMoney(Number(v))} />
                <Bar dataKey="value" fill={CHART.accent} radius={6} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
    </main>
  )
}
