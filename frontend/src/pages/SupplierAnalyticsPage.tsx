import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { fetchPickupBranches, useSupplierOrg } from '@/shared/lib/commerce'
import { formatMoney } from '@/shared/lib/money'

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
  outstanding_payments?: number
  deliveries_count?: number
  popular_products?: Array<{ product_id: string; name: string; qty: number; revenue_minor: number }>
  sales_dynamics?: Array<{ period: string; orders: number; revenue_minor: number }>
  top_salons?: Array<{ branch_id: string; orders: number; revenue_minor: number }>
  representatives?: Array<{ user_id: string; orders: number; collected_minor: number; remaining_minor: number }>
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
      const p = period === 'custom'
        ? `from=${from}&to=${to}`
        : `period=${period}`
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
  const chartMoney = (v: number) => formatMoney(v)
  return (
    <main className="page stack">
      <div className="stack-sm">
        <p className="eyebrow">Поставщик</p>
        <h1>Аналитика</h1>
        <p className="muted">{supplierOrg?.organization.name} · выручка считается по оплаченным заказам</p>
      </div>
      <div className="chip-row">
        {[['day', 'День'], ['week', 'Неделя'], ['month', 'Месяц'], ['quarter', 'Квартал'], ['custom', 'Период']].map(([id, label]) => (
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
        <article className="card stack-sm"><p className="muted">Revenue</p><strong>{formatMoney(a?.revenue_minor ?? a?.revenue_month_minor ?? 0)}</strong><p className="muted">за выбранный период</p></article>
        <article className="card stack-sm"><p className="muted">Orders</p><strong>{a?.orders_count ?? a?.orders_month ?? 0}</strong><p className="muted">сегодня {a?.orders_today ?? 0}</p></article>
        <article className="card stack-sm"><p className="muted">Average order</p><strong>{formatMoney(a?.average_order_value_minor ?? 0)}</strong></article>
        <article className="card stack-sm"><p className="muted">Outstanding</p><strong>{a?.outstanding_payments ?? a?.unpaid_orders ?? 0}</strong><p className="muted">незакрытых оплат</p></article>
        <article className="card stack-sm"><p className="muted">Deliveries</p><strong>{a?.deliveries_count ?? 0}</strong><p className="muted">доставок клиентам</p></article>
      </div>
      <section className="card stack">
        <h2>Revenue Dynamics</h2>
        <div className="dashboard-chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={a?.sales_dynamics ?? []}>
              <defs><linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2f6f78" stopOpacity={0.32}/><stop offset="100%" stopColor="#2f6f78" stopOpacity={0.02}/></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="period" />
              <YAxis tickFormatter={(v) => String(Math.round(Number(v) / 100))} />
              <Tooltip formatter={(v) => chartMoney(Number(v))} />
              <Area type="monotone" dataKey="revenue_minor" stroke="#2f6f78" fill="url(#revFill)" name="Выручка" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="card stack">
        <h2>Orders Dynamics</h2>
        <div className="dashboard-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={a?.sales_dynamics ?? []}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="period" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="orders" fill="#c4a574" name="Заказы" radius={6} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="card stack">
        <h2>Popular Products</h2>
        {(a?.popular_products ?? []).length === 0 && <p className="muted">Пока нет продаж</p>}
        {(a?.popular_products ?? []).length > 0 && (
          <div className="dashboard-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={a?.popular_products ?? []} layout="vertical" margin={{ left: 16 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" />
                <YAxis type="category" dataKey="name" width={140} />
                <Tooltip formatter={(v) => chartMoney(Number(v))} />
                <Bar dataKey="revenue_minor" name="Продажи" fill="#8f6a55" radius={6} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
      <section className="card stack">
        <h2>Sales by Product</h2>
        {(a?.popular_products ?? []).map((p) => (
          <article key={p.product_id} className="list-item row between">
            <div><strong>{p.name}</strong><p className="muted">{p.qty} шт.</p></div>
            <span>{formatMoney(p.revenue_minor)}</span>
          </article>
        ))}
      </section>
      <section className="card stack">
        <h2>Representatives Performance</h2>
        {(a?.representatives ?? []).length === 0 && <p className="muted">Нет данных по представителям</p>}
        {(a?.representatives ?? []).map((r) => (
          <article key={r.user_id} className="list-item row between">
            <div><strong>{repNames[r.user_id] || 'Представитель'}</strong><p className="muted">{r.orders} заказов</p></div>
            <span>собрано {formatMoney(r.collected_minor)} · ожидание {formatMoney(r.remaining_minor)}</span>
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
