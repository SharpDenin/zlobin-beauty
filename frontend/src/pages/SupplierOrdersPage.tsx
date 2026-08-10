import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useSupplierOrg, type SupplierOrder } from '@/shared/lib/commerce'
import { formatMoney } from '@/shared/lib/money'
import { statusBadgeClass, supplierOrderActionLabel, supplierOrderLabel } from '@/shared/lib/status'

const nextStatus: Record<string, string> = {
  new: 'confirmed',
  submitted: 'confirmed',
  confirmed: 'picking',
  picking: 'in_transit',
  in_transit: 'delivered',
  in_delivery: 'delivered',
}

export function SupplierOrdersPage() {
  const { accessToken } = useAuth()
  const { supplierOrgId, supplierOrg, orgs } = useSupplierOrg()
  const qc = useQueryClient()
  const [deliveryDraft, setDeliveryDraft] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const orders = useQuery({
    queryKey: ['commerce-supplier-orders', 'supplier', supplierOrgId],
    queryFn: () =>
      apiRequest<{ items: SupplierOrder[] }>(
        `/v1/commerce/supplier-orders?organization_id=${supplierOrgId}&role=supplier`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && supplierOrgId),
  })

  const transition = useMutation({
    mutationFn: (input: { id: string; status: string; estimated_delivery_at?: string }) =>
      apiRequest(`/v1/commerce/supplier-orders/${input.id}/transition`, {
        token: accessToken,
        body: {
          status: input.status,
          ...(input.estimated_delivery_at
            ? { estimated_delivery_at: new Date(input.estimated_delivery_at).toISOString() }
            : {}),
        },
      }),
    onSuccess: async () => {
      setError(null)
      setOk('Статус обновлён')
      await qc.invalidateQueries({ queryKey: ['commerce-supplier-orders'] })
      await qc.invalidateQueries({ queryKey: ['supplier-dashboard'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось обновить статус'),
  })

  if (orgs.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>

  if (!supplierOrgId) {
    return (
      <main className="page">
        <div className="empty-state">
          <h2>Сначала создайте поставщика</h2>
          <Link className="btn btn-primary" to="/supplier">Онбординг</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="page stack">
      <div className="row between">
        <div className="stack-sm">
          <h1>Заказы салонов</h1>
          <p className="muted">{supplierOrg?.organization.name}</p>
        </div>
      </div>

      <div className="tabs">
        <Link to="/supplier/products">Товары</Link>
        <Link className="active" to="/supplier/orders">Заказы</Link>
      </div>

      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}

      {orders.isLoading && <div className="state-box">Загрузка…</div>}
      {orders.isError && <div className="state-box error">Не удалось загрузить заказы</div>}
      {orders.data && orders.data.items.length === 0 && (
        <div className="empty-state">
          <h2>Пока нет заказов</h2>
          <p>Когда салоны оформят заказ, он появится здесь.</p>
        </div>
      )}

      <div className="list">
        {orders.data?.items.map((o) => {
          const next = nextStatus[o.status]
          const actionLabel = next ? (supplierOrderActionLabel[next] ?? supplierOrderLabel(next)) : null
          return (
            <article key={o.id} className="history-card stack-sm">
              <div className="row between">
                <strong>{formatMoney(o.total_minor)}</strong>
                <span className={`badge ${statusBadgeClass(o.status)}`}>{supplierOrderLabel(o.status)}</span>
              </div>
              <p className="muted">{new Date(o.created_at).toLocaleString('ru-RU')}</p>
              {o.estimated_delivery_at && (
                <p>Доставка: {new Date(o.estimated_delivery_at).toLocaleDateString('ru-RU')}</p>
              )}
              {o.comment && <p>{o.comment}</p>}
              {o.items && o.items.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {o.items.map((it, idx) => (
                    <li key={`${o.id}-${idx}`}>
                      {it.product_name || 'Товар'} · {it.qty_ordered} шт
                    </li>
                  ))}
                </ul>
              )}
              {next && (
                <div className="stack-sm">
                  {(next === 'confirmed' || next === 'in_transit' || next === 'picking') && (
                    <div className="field">
                      <label>Ожидаемая дата доставки</label>
                      <input
                        type="date"
                        value={deliveryDraft[o.id] ?? ''}
                        onChange={(e) => setDeliveryDraft((prev) => ({ ...prev, [o.id]: e.target.value }))}
                      />
                    </div>
                  )}
                  <div className="row">
                    <button
                      className="btn btn-primary btn-compact"
                      type="button"
                      disabled={transition.isPending}
                      onClick={() =>
                        transition.mutate({
                          id: o.id,
                          status: next,
                          estimated_delivery_at: deliveryDraft[o.id] || undefined,
                        })
                      }
                    >
                      {actionLabel}
                    </button>
                    {(o.status === 'new' || o.status === 'submitted' || o.status === 'confirmed') && (
                      <button
                        className="btn btn-secondary btn-compact"
                        type="button"
                        disabled={transition.isPending}
                        onClick={() => transition.mutate({ id: o.id, status: 'cancelled' })}
                      >
                        Отменить
                      </button>
                    )}
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </main>
  )
}
