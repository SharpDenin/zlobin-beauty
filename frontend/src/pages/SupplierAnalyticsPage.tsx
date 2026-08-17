import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useSupplierOrg } from '@/shared/lib/commerce'
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

  if (orgs.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>
  if (!supplierOrgId) return <main className="page"><div className="empty-state"><h2>Нет организации</h2></div></main>

  const a = q.data
  return (
    <main className="page stack">
      <h1>Аналитика</h1>
      <p className="muted">{supplierOrg?.organization.name} · по оплаченным заказам, не по цене каталога</p>
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
      <div className="cards-grid">
        <article className="card stack-sm"><p className="muted">Выручка сегодня</p><strong>{formatMoney(a?.revenue_today_minor ?? 0)}</strong></article>
        <article className="card stack-sm"><p className="muted">Выручка месяц</p><strong>{formatMoney(a?.revenue_month_minor ?? 0)}</strong></article>
        <article className="card stack-sm"><p className="muted">Выручка квартал</p><strong>{formatMoney(a?.revenue_quarter_minor ?? 0)}</strong></article>
        <article className="card stack-sm"><p className="muted">Заказы сегодня / месяц</p><strong>{a?.orders_today ?? 0} / {a?.orders_month ?? 0}</strong></article>
        <article className="card stack-sm"><p className="muted">Средний чек</p><strong>{formatMoney(a?.average_order_value_minor ?? 0)}</strong></article>
        <article className="card stack-sm"><p className="muted">К оплате</p><strong>{a?.outstanding_payments ?? a?.unpaid_orders ?? 0}</strong></article>
      </div>
      <section className="card stack">
        <h2>Динамика продаж</h2>
        <div style={{ height: 260 }}>
          <ResponsiveContainer>
            <AreaChart data={a?.sales_dynamics ?? []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" />
              <YAxis />
              <Tooltip />
              <Area dataKey="revenue_minor" stroke="#2f5d50" fill="#d7ebe3" name="Выручка" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="card stack">
        <h2>Заказы</h2>
        <div style={{ height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={a?.sales_dynamics ?? []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="orders" fill="#c4a574" name="Заказы" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="card stack">
        <h2>Популярные товары</h2>
        {(a?.popular_products ?? []).length === 0 && <p className="muted">Пока нет продаж</p>}
        <div className="list">
          {(a?.popular_products ?? []).map((p) => (
            <article key={p.product_id} className="list-item row between">
              <span>{p.name}</span>
              <span>{formatMoney(p.revenue_minor)}</span>
            </article>
          ))}
        </div>
      </section>
      <section className="card stack">
        <h2>Топ салонов</h2>
        {(a?.top_salons ?? []).map((s) => (
          <article key={s.branch_id} className="list-item row between">
            <span>Филиал {s.branch_id.slice(0, 8)}</span>
            <span>{formatMoney(s.revenue_minor)} · {s.orders}</span>
          </article>
        ))}
      </section>
      <section className="card stack">
        <h2>Представители</h2>
        {(a?.representatives ?? []).map((r) => (
          <article key={r.user_id} className="list-item row between">
            <span>{r.user_id.slice(0, 8)}</span>
            <span>собрано {formatMoney(r.collected_minor)} / ожидание {formatMoney(r.remaining_minor)}</span>
          </article>
        ))}
      </section>
    </main>
  )
}
