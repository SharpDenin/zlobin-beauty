import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { fetchPickupBranches, useSupplierOrg } from '@/shared/lib/commerce'
import { formatMoney } from '@/shared/lib/money'
import { CHART, CHART_SERIES } from '@/shared/ui/chart-theme'

type Analytics = {
  revenue_today_minor?: number
  revenue_month_minor?: number
  revenue_quarter_minor?: number
  revenue_minor?: number
  orders_today?: number
  orders_month?: number
  orders_count?: number
  average_order_value_minor?: number
  unpaid_orders?: number
  unpaid_minor?: number
  paid_minor?: number
  outstanding?: { paid_minor: number; expected_minor: number }
  deliveries_count?: number
  deliveries_today?: number
  popular_products?: Array<{ product_id: string; name: string; qty: number; revenue_minor: number }>
  sales_by_category?: Array<{ category: string; revenue_minor: number }>
  sales_dynamics?: Array<{ period: string; orders: number; revenue_minor: number }>
  top_salons?: Array<{ branch_id: string; orders: number; revenue_minor: number }>
  representatives?: Array<{ user_id: string; orders: number; collected_minor: number; remaining_minor: number; deliveries_today?: number; unfinished_deliveries?: number }>
}

export function SupplierAnalyticsPage() {
  const { accessToken } = useAuth()
  const { supplierOrgId, supplierOrg, orgs } = useSupplierOrg()
  const [period, setPeriod] = useState('month')
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  const q = useQuery({
    queryKey: ['supplier-analytics', supplierOrgId, period, from, to],
    queryFn: () => {
      const p = period === 'custom' ? `from=${from}&to=${to}` : `period=${period}`
      return apiRequest<Analytics>(`/v1/commerce/supplier/analytics?organization_id=${supplierOrgId}&${p}`, { token: accessToken })
    },
    enabled: Boolean(accessToken && supplierOrgId),
  })
  const reps = useQuery({
    queryKey: ['supplier-reps', supplierOrgId],
    queryFn: () => apiRequest<{ items: Array<{ user_id?: string; display_name?: string; city?: string }> }>(`/v1/organizations/${supplierOrgId}/representatives`, { token: accessToken }),
    enabled: Boolean(accessToken && supplierOrgId),
  })
  const salons = useQuery({
    queryKey: ['pickup-branches-analytics'],
    queryFn: () => fetchPickupBranches(accessToken),
    enabled: Boolean(accessToken),
  })
  const salonNames = useMemo(() => Object.fromEntries((salons.data ?? []).map((b) => [b.id, b.name])), [salons.data])
  const repNames = useMemo(() => Object.fromEntries((reps.data?.items ?? []).map((r) => [r.user_id ?? '', r.display_name || r.city || 'Представитель'])), [reps.data])

  if (orgs.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>
  if (!supplierOrgId) return <main className="page"><div className="empty-state"><h2>Нет организации</h2></div></main>

  const a = q.data
  const outstanding = [
    { name: 'Оплачено', value: a?.outstanding?.paid_minor ?? a?.paid_minor ?? 0 },
    { name: 'Ожидается', value: a?.outstanding?.expected_minor ?? a?.unpaid_minor ?? 0 },
  ]
  const repBars = (a?.representatives ?? []).map((r) => ({
    name: r.user_id === 'unassigned' ? 'Без назначения' : (repNames[r.user_id] || 'Представитель'),
    collected: r.collected_minor,
    remaining: r.remaining_minor,
    orders: r.orders,
  }))

  return (
    <main className="page stack">
      <div className="stack-sm">
        <p className="eyebrow">Поставщик</p>
        <h1>Аналитика</h1>
        <p className="muted">{supplierOrg?.organization.name} · выручка по оплаченным заказам, не по цене каталога</p>
      </div>
      <div className="chip-row">
        {[['day', 'Сегодня'], ['week', 'Неделя'], ['month', 'Месяц'], ['quarter', 'Квартал'], ['custom', 'Период']].map(([id, label]) => (
          <button key={id} type="button" className={`chip ${period === id ? 'active' : ''}`} onClick={() => setPeriod(id)}>{label}</button>
        ))}
      </div>
      {period === 'custom' && (
        <div className="row">
          <div className="field"><label>С</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="field"><label>По</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
      )}
      {q.isLoading && <div className="state-box">Считаем агрегаты…</div>}
      <div className="kpi-grid">
        <article className="card stack-sm"><p className="muted">Выручка периода</p><strong>{formatMoney(a?.revenue_minor ?? a?.revenue_month_minor ?? 0)}</strong></article>
        <article className="card stack-sm"><p className="muted">Заказы</p><strong>{a?.orders_count ?? a?.orders_month ?? 0}</strong><p className="muted">сегодня {a?.orders_today ?? 0}</p></article>
        <article className="card stack-sm"><p className="muted">Средний чек</p><strong>{formatMoney(a?.average_order_value_minor ?? 0)}</strong></article>
        <article className="card stack-sm"><p className="muted">Ожидает оплаты</p><strong>{formatMoney(a?.unpaid_minor ?? 0)}</strong><p className="muted">{a?.unpaid_orders ?? 0} заказов</p></article>
        <article className="card stack-sm"><p className="muted">Доставки</p><strong>{a?.deliveries_count ?? 0}</strong><p className="muted">сегодня {a?.deliveries_today ?? 0}</p></article>
      </div>
      <section className="card stack">
        <h2>Динамика выручки</h2>
        <div className="dashboard-chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={a?.sales_dynamics ?? []}>
              <defs><linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={CHART.accent} stopOpacity={0.32}/><stop offset="100%" stopColor={CHART.accent} stopOpacity={0.02}/></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="period" />
              <YAxis tickFormatter={(v) => String(Math.round(Number(v) / 100))} />
              <Tooltip formatter={(v) => formatMoney(Number(v))} />
              <Area type="monotone" dataKey="revenue_minor" stroke={CHART.accent} fill="url(#revFill)" name="Выручка" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="card stack">
        <h2>Динамика заказов</h2>
        <div className="dashboard-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={a?.sales_dynamics ?? []}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="period" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="orders" fill={CHART.gold} name="Заказы" radius={6} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="card stack">
        <h2>Популярные товары</h2>
        {(a?.popular_products ?? []).length === 0 && <p className="muted">Пока нет продаж</p>}
        {(a?.popular_products ?? []).length > 0 && (
          <div className="dashboard-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={a?.popular_products ?? []} layout="vertical" margin={{ left: 16 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" />
                <YAxis type="category" dataKey="name" width={140} />
                <Tooltip formatter={(v) => formatMoney(Number(v))} />
                <Bar dataKey="revenue_minor" name="Продажи" fill={CHART.clay} radius={6} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
      <section className="card stack">
        <h2>Продажи по категориям</h2>
        {(a?.sales_by_category ?? []).length === 0 && <p className="muted">Нет разбивки по категориям</p>}
        {(a?.sales_by_category ?? []).length > 0 && (
          <div className="dashboard-chart">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={a?.sales_by_category ?? []} dataKey="revenue_minor" nameKey="category" innerRadius={48} outerRadius={78} paddingAngle={2}>
                  {(a?.sales_by_category ?? []).map((_, i) => (
                    <Cell key={i} fill={CHART_SERIES[i % CHART_SERIES.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => formatMoney(Number(v))} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
      <section className="card stack">
        <h2>Оплаты: получено и ожидается</h2>
        <div className="dashboard-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={outstanding}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" />
              <YAxis tickFormatter={(v) => String(Math.round(Number(v) / 100))} />
              <Tooltip formatter={(v) => formatMoney(Number(v))} />
              <Bar dataKey="value" radius={6}>
                <Cell fill={CHART.success} />
                <Cell fill={CHART.gold} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="card stack">
        <h2>Представители</h2>
        {repBars.length === 0 && <p className="muted">Нет данных по представителям</p>}
        {repBars.length > 0 && (
          <div className="dashboard-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={repBars}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" />
                <YAxis tickFormatter={(v) => String(Math.round(Number(v) / 100))} />
                <Tooltip formatter={(v) => formatMoney(Number(v))} />
                <Bar dataKey="collected" fill={CHART.accent} name="Собрано" radius={6} />
                <Bar dataKey="remaining" fill={CHART.gold} name="Ожидается" radius={6} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {(a?.representatives ?? []).map((r) => (
          <article key={r.user_id} className="list-item row between">
            <div>
              <strong>{r.user_id === 'unassigned' ? 'Без назначения' : (repNames[r.user_id] || 'Представитель')}</strong>
              <p className="muted">{r.orders} заказов · сегодня {r.deliveries_today ?? 0} · незавершено {r.unfinished_deliveries ?? 0}</p>
            </div>
            <span>собрано {formatMoney(r.collected_minor)}</span>
          </article>
        ))}
      </section>
      <section className="card stack">
        <h2>Салоны</h2>
        {(a?.top_salons ?? []).map((s) => (
          <article key={s.branch_id} className="list-item row between">
            <span>{salonNames[s.branch_id] || 'Салон'}</span>
            <span>{formatMoney(s.revenue_minor)} · {s.orders}</span>
          </article>
        ))}
      </section>
    </main>
  )
}
