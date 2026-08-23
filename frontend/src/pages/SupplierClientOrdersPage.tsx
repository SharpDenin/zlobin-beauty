import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useSupplierOrg } from '@/shared/lib/commerce'
import { formatMoney } from '@/shared/lib/money'
import { clientOrderLabel, statusBadgeClass } from '@/shared/lib/status'

type ClientOrderRow = {
  id: string
  order_number?: string
  status: string
  total_minor: number
  delivery_address: string
  created_at: string
  items?: Array<{ product_name: string; brand: string; qty: number }>
}

export function SupplierClientOrdersPage() {
  const { accessToken } = useAuth()
  const { supplierOrgId } = useSupplierOrg()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const orders = useQuery({
    queryKey: ['supplier-client-orders', supplierOrgId],
    queryFn: () =>
      apiRequest<{ items: ClientOrderRow[] }>(
        `/v1/commerce/shop/supplier/orders?organization_id=${supplierOrgId}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && supplierOrgId),
  })

  const transition = useMutation({
    mutationFn: (input: { id: string; status: string }) =>
      apiRequest(`/v1/commerce/shop/supplier/orders/${input.id}/transition`, {
        method: 'POST',
        token: accessToken,
        body: { status: input.status },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplier-client-orders'] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Ошибка'),
  })

  return (
    <main className="page stack">
      <header className="stack-sm">
        <p className="eyebrow">Поставщик</p>
        <h1>Заказы клиентов</h1>
      </header>
      {error && <div className="state-box error">{error}</div>}
      {orders.isLoading && <div className="state-box">Загрузка…</div>}
      <div className="stack">
        {orders.data?.items.map((o) => (
          <article key={o.id} className="card stack-sm">
            <div className="row between">
              <strong>{o.order_number ?? formatMoney(o.total_minor)}</strong>
              <span className={`badge ${statusBadgeClass(o.status)}`}>{clientOrderLabel(o.status)}</span>
            </div>
            <p className="muted">{new Date(o.created_at).toLocaleString('ru-RU')}</p>
            <p>{(o.items ?? []).map((it) => `${it.brand} ${it.product_name} × ${it.qty}`).join(', ')}</p>
            <p className="muted">{o.delivery_address}</p>
            <div className="row">
              {o.status === 'submitted' && (
                <button className="btn btn-primary btn-compact" type="button" onClick={() => transition.mutate({ id: o.id, status: 'confirmed' })}>Подтвердить</button>
              )}
              {o.status === 'confirmed' && (
                <button className="btn btn-primary btn-compact" type="button" onClick={() => transition.mutate({ id: o.id, status: 'picking' })}>В сборку</button>
              )}
              {o.status === 'picking' && (
                <button className="btn btn-primary btn-compact" type="button" onClick={() => transition.mutate({ id: o.id, status: 'in_delivery' })}>В доставку</button>
              )}
            </div>
          </article>
        ))}
      </div>
    </main>
  )
}
