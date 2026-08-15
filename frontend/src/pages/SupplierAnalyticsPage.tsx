import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useSupplierOrg } from '@/shared/lib/commerce'
import { formatMoney } from '@/shared/lib/money'

type Analytics = {
  revenue_minor?: number
  orders_count?: number
  average_order_value_minor?: number
  unpaid_orders?: number
  popular_products?: Array<{ product_id: string; name: string; qty: number; revenue_minor: number }>
}

export function SupplierAnalyticsPage() {
  const { accessToken } = useAuth()
  const { supplierOrgId, supplierOrg, orgs } = useSupplierOrg()
  const q = useQuery({
    queryKey: ['supplier-analytics', supplierOrgId],
    queryFn: () =>
      apiRequest<Analytics>(`/v1/commerce/supplier/analytics?organization_id=${supplierOrgId}`, { token: accessToken }),
    enabled: Boolean(accessToken && supplierOrgId),
  })

  if (orgs.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>
  if (!supplierOrgId) return <main className="page"><div className="empty-state"><h2>Нет организации</h2></div></main>

  const a = q.data
  return (
    <main className="page stack">
      <h1>Аналитика</h1>
      <p className="muted">{supplierOrg?.organization.name} · по оплаченным заказам, не по текущей цене каталога</p>
      {q.isLoading && <div className="state-box">Считаем агрегаты…</div>}
      <div className="cards-grid">
        <article className="card stack-sm"><p className="muted">Выручка</p><strong>{formatMoney(a?.revenue_minor ?? 0)}</strong></article>
        <article className="card stack-sm"><p className="muted">Заказы</p><strong>{a?.orders_count ?? 0}</strong></article>
        <article className="card stack-sm"><p className="muted">Средний чек</p><strong>{formatMoney(a?.average_order_value_minor ?? 0)}</strong></article>
        <article className="card stack-sm"><p className="muted">Не оплачено</p><strong>{a?.unpaid_orders ?? 0}</strong></article>
      </div>
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
    </main>
  )
}
