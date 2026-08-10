import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useBuyerOrg, type SupplierOrder } from '@/shared/lib/commerce'
import { formatMoney } from '@/shared/lib/money'
import { statusBadgeClass, supplierOrderLabel } from '@/shared/lib/status'

export function CosmeticsOrdersPage() {
  const { accessToken } = useAuth()
  const { buyerOrgId, buyerOrg, orgs } = useBuyerOrg()

  const orders = useQuery({
    queryKey: ['commerce-supplier-orders', 'buyer', buyerOrgId],
    queryFn: () =>
      apiRequest<{ items: SupplierOrder[] }>(
        `/v1/commerce/supplier-orders?organization_id=${buyerOrgId}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && buyerOrgId),
  })

  if (orgs.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>

  if (!buyerOrgId) {
    return (
      <main className="page">
        <div className="empty-state">
          <h2>Нужен салон</h2>
          <Link className="btn btn-primary" to="/master">Кабинет</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="page stack">
      <div className="row between">
        <div className="stack-sm">
          <h1>Заказы косметики</h1>
          <p className="muted">{buyerOrg?.organization.name}</p>
        </div>
        <Link className="btn btn-primary btn-compact" to="/cosmetics">К поставщикам</Link>
      </div>

      {orders.isLoading && <div className="state-box">Загрузка…</div>}
      {orders.isError && <div className="state-box error">Не удалось загрузить заказы</div>}
      {orders.data && orders.data.items.length === 0 && (
        <div className="empty-state">
          <h2>Заказов пока нет</h2>
          <p>Выберите поставщика и соберите корзину.</p>
          <Link className="btn btn-primary" to="/cosmetics">Открыть каталог</Link>
        </div>
      )}

      <div className="list">
        {orders.data?.items.map((o) => (
          <article key={o.id} className="history-card">
            <div className="row between">
              <strong>{formatMoney(o.total_minor)}</strong>
              <span className={`badge ${statusBadgeClass(o.status)}`}>{supplierOrderLabel(o.status)}</span>
            </div>
            <p className="muted">{new Date(o.created_at).toLocaleString('ru-RU')}</p>
            {o.estimated_delivery_at && (
              <p>Ожидаемая доставка: {new Date(o.estimated_delivery_at).toLocaleDateString('ru-RU')}</p>
            )}
            {o.comment && <p>{o.comment}</p>}
            {o.items && o.items.length > 0 && (
              <ul className="stack-sm" style={{ paddingLeft: 18, margin: 0 }}>
                {o.items.map((it, idx) => (
                  <li key={`${o.id}-${idx}`}>
                    {it.product_name || 'Товар'} · {it.qty_ordered} шт · {formatMoney(it.price_minor)}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </main>
  )
}
