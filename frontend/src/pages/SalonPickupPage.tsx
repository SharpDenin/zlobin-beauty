import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiRequest } from '@/shared/api/client'
import { formatUserError } from '@/shared/lib/app-error'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { useAuth } from '@/features/auth/AuthProvider'
import { useBuyerOrg } from '@/shared/lib/commerce'
import { formatMoney } from '@/shared/lib/money'
import { clientOrderLabel, paymentStatusLabel, statusBadgeClass } from '@/shared/lib/status'

type PickupOrder = {
  id: string
  order_number?: string
  status: string
  total_minor: number
  payment_method?: string
  payment_status?: string
  user_id?: string
  created_at: string
  items?: Array<{ product_name: string; brand: string; qty: number; price_minor: number }>
}

export function SalonPickupPage() {
  const { accessToken } = useAuth()
  const { buyerOrg } = useBuyerOrg()
  const branchId = buyerOrg?.branches?.[0]?.id
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const orders = useQuery({
    queryKey: ['salon-pickup', branchId],
    queryFn: () =>
      apiRequest<{ items: PickupOrder[] }>(
        `/v1/commerce/shop/pickup/orders?branch_id=${branchId}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && branchId),
  })

  const accept = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/v1/commerce/shop/pickup/orders/${id}/accept`, { method: 'POST', token: accessToken }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['salon-pickup'] }),
    onError: (e) => setError(formatUserError(e, 'Не удалось принять')),
  })
  const handover = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/v1/commerce/shop/pickup/orders/${id}/handover`, {
        method: 'POST',
        token: accessToken,
        body: { payment_received: true },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['salon-pickup'] }),
    onError: (e) => setError(formatUserError(e, 'Не удалось выдать')),
  })

  return (
    <main className="page stack">
      <header className="stack-sm">
        <p className="eyebrow">Салон</p>
        <h1>Заказы на выдачу</h1>
      </header>
      {error && <ErrorBanner error={error} />}
      {!branchId && <div className="state-box">Выберите салон в профиле</div>}
      {orders.isLoading && <div className="state-box">Загрузка…</div>}
      {orders.data?.items.length === 0 && <div className="state-box">Нет заказов на выдачу</div>}
      <div className="stack">
        {orders.data?.items.map((o) => (
          <article key={o.id} className="card stack-sm">
            <div className="row between">
              <strong>{o.order_number ?? formatMoney(o.total_minor)}</strong>
              <span className={`badge ${statusBadgeClass(o.status)}`}>{clientOrderLabel(o.status)}</span>
            </div>
            <p className="muted">{new Date(o.created_at).toLocaleString('ru-RU')}</p>
            <p>{(o.items ?? []).map((it) => `${it.brand} ${it.product_name} × ${it.qty}`).join(', ')}</p>
            <p className="muted">{formatMoney(o.total_minor)} · {paymentStatusLabel(o.payment_status)}</p>
            <div className="row">
              {o.status === 'delivered' && (
                <button className="btn btn-primary btn-compact" type="button" disabled={accept.isPending} onClick={() => accept.mutate(o.id)}>
                  Принять в салоне
                </button>
              )}
              {o.status === 'ready_for_pickup' && (
                <button className="btn btn-primary btn-compact" type="button" disabled={handover.isPending} onClick={() => handover.mutate(o.id)}>
                  Выдать клиенту
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </main>
  )
}
