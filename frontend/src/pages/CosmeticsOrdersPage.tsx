import { Link, useSearchParams } from 'react-router-dom'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  fetchBranch,
  paymentMethodLabel,
  useBuyerOrg,
  type SupplierOrder,
} from '@/shared/lib/commerce'
import { formatMoney } from '@/shared/lib/money'
import { paymentStatusLabel, statusBadgeClass, supplierOrderLabel } from '@/shared/lib/status'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { supplierOrderIsTerminal } from '@/pages/supplier-helpers'

export function CosmeticsOrdersPage() {
  const { accessToken } = useAuth()
  const { buyerOrgId, buyerOrg, orgs } = useBuyerOrg()
  const [params] = useSearchParams()
  const highlightId = params.get('highlight') ?? ''

  const orders = useQuery({
    queryKey: ['commerce-supplier-orders', 'buyer', buyerOrgId],
    queryFn: () =>
      apiRequest<{ items: SupplierOrder[] }>(
        `/v1/commerce/supplier-orders?organization_id=${buyerOrgId}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && buyerOrgId),
  })

  useEffect(() => {
    if (!highlightId || !orders.data?.items?.length) return
    const el = document.getElementById(`order-${highlightId}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlightId, orders.data])

  if (orgs.isLoading) return <main className="page"><div className="skeleton skeleton-card" aria-busy="true" /></main>

  if (!buyerOrgId) {
    return (
      <main className="page">
        <EmptyState title="Нужен салон" action={<Link className="btn btn-primary" to="/master">Кабинет</Link>} />
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
        <Link className="btn btn-secondary btn-compact" to="/inventory/receipts">На приёмке</Link>
      </div>

      {orders.isLoading && <div className="skeleton skeleton-card" aria-busy="true" />}
      {orders.isError && <ErrorBanner error={orders.error} fallbackTitle="Не удалось загрузить заказы" />}
      {orders.data && orders.data.items.length === 0 && (
        <EmptyState
          title="Заказов пока нет"
          text="Выберите поставщика и соберите корзину."
          action={<Link className="btn btn-primary" to="/cosmetics">Открыть каталог</Link>}
        />
      )}

      <div className="list">
        {orders.data?.items.map((o) => (
          <article
            key={o.id}
            id={`order-${o.id}`}
            className={`history-card${supplierOrderIsTerminal(o.status) ? ' is-terminal' : ''}${highlightId === o.id ? ' selected' : ''}`}
            data-highlighted={highlightId === o.id ? 'true' : undefined}
          >
            <div className="row between">
              <strong>{formatMoney(o.total_minor)}</strong>
              <span className={`badge ${statusBadgeClass(o.status)}`}>{supplierOrderLabel(o.status)}</span>
            </div>
            <p className="muted">{new Date(o.created_at).toLocaleString('ru-RU')}</p>
            {(o.payment_method || o.payment_status) && (
              <div className="row">
                {o.payment_method && <span className="chip badge-default">{paymentMethodLabel(o.payment_method)}</span>}
                {o.payment_status && (
                  <span className={`badge ${statusBadgeClass(o.payment_status)}`}>
                    {paymentStatusLabel(o.payment_status)}
                  </span>
                )}
              </div>
            )}
            {o.destination_branch_id && (
              <DestinationLine branchId={o.destination_branch_id} token={accessToken} />
            )}
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

function DestinationLine({ branchId, token }: { branchId: string; token: string | null }) {
  const branch = useQuery({
    queryKey: ['branch', branchId],
    queryFn: () => fetchBranch(token, branchId),
    enabled: Boolean(token && branchId),
  })
  if (branch.data) {
    return (
      <p>
        Получение: {branch.data.name}
        {branch.data.city ? `, ${branch.data.city}` : ''}
        {branch.data.address_line ? ` · ${branch.data.address_line}` : ''}
      </p>
    )
  }
  return <p className="muted">Филиал получения указан</p>
}
