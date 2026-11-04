import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useSupplierOrg } from '@/shared/lib/commerce'
import { formatMoney } from '@/shared/lib/money'
import { clientOrderLabel, paymentStatusLabel, statusBadgeClass } from '@/shared/lib/status'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { Modal } from '@/shared/ui/Modal'
import { toast } from '@/shared/ui/Toast'
import { supplierOrderIsTerminal } from '@/pages/supplier-helpers'

type ClientOrderRow = {
  id: string
  order_number?: string
  status: string
  total_minor: number
  delivery_address: string
  payment_status?: string
  returned?: boolean
  created_at: string
  items?: Array<{ product_name: string; brand: string; qty: number }>
}

export function SupplierClientOrdersPage() {
  const { accessToken } = useAuth()
  const { supplierOrgId } = useSupplierOrg()
  const qc = useQueryClient()
  const [error, setError] = useState<unknown>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [returnTarget, setReturnTarget] = useState<ClientOrderRow | null>(null)
  const [returnReason, setReturnReason] = useState('')

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
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: ['supplier-client-orders'] })
      setError(null)
      const copy = input.status === 'confirmed' ? 'Заказ подтверждён' : 'Статус заказа обновлён'
      setOk(copy)
      toast.success(copy)
    },
    onError: (e) => setError(e),
  })

  const returnOrder = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      apiRequest(`/v1/commerce/shop/supplier/orders/${input.id}/return`, {
        method: 'POST',
        token: accessToken,
        body: { reason: input.reason },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['supplier-client-orders'] })
      setError(null)
      setReturnTarget(null)
      setReturnReason('')
      setOk('Возврат оформлен')
      toast.success('Возврат оформлен')
    },
    onError: (e) => setError(e),
  })

  return (
    <main className="page stack">
      <header className="stack-sm">
        <p className="eyebrow">Поставщик</p>
        <h1>Заказы клиентов</h1>
      </header>
      <ErrorBanner error={error} fallbackTitle="Не удалось обновить заказ" />
      {ok && <p className="muted" role="status">{ok}</p>}
      {orders.isLoading && <div className="skeleton skeleton-card" aria-busy="true" />}
      {orders.isError && <ErrorBanner error={orders.error} fallbackTitle="Не удалось загрузить заказы" />}
      {!orders.isLoading && (orders.data?.items.length ?? 0) === 0 && (
        <EmptyState title="Заказов пока нет" text="Когда клиенты оформят покупку, заказ появится здесь." />
      )}
      <div className="stack">
        {orders.data?.items.map((o) => (
          <article key={o.id} className={`card stack-sm${supplierOrderIsTerminal(o.status) || o.returned ? ' is-terminal' : ''}`}>
            <div className="row between">
              <strong>{o.order_number ?? formatMoney(o.total_minor)}</strong>
              <span className={`badge ${statusBadgeClass(o.status)}`}>
                {o.returned ? 'Возврат' : clientOrderLabel(o.status)}
              </span>
            </div>
            <p className="muted">{new Date(o.created_at).toLocaleString('ru-RU')}</p>
            <p>{(o.items ?? []).map((it) => `${it.brand} ${it.product_name} × ${it.qty}`).join(', ')}</p>
            <p className="muted">{o.delivery_address}</p>
            {(o.payment_status || o.returned) && (
              <p className="muted">Оплата: {paymentStatusLabel(o.payment_status)}{o.returned ? ' · возврат зафиксирован' : ''}</p>
            )}
            <div className="row wrap">
              {o.status === 'submitted' && (
                <button className="btn btn-primary btn-compact" type="button" disabled={transition.isPending} onClick={() => transition.mutate({ id: o.id, status: 'confirmed' })}>Подтвердить</button>
              )}
              {o.status === 'confirmed' && (
                <button className="btn btn-primary btn-compact" type="button" disabled={transition.isPending} onClick={() => transition.mutate({ id: o.id, status: 'picking' })}>В сборку</button>
              )}
              {o.status === 'picking' && (
                <button className="btn btn-primary btn-compact" type="button" disabled={transition.isPending} onClick={() => transition.mutate({ id: o.id, status: 'in_delivery' })}>В доставку</button>
              )}
              {o.status === 'received' && !o.returned && (
                <button
                  className="btn btn-secondary btn-compact"
                  type="button"
                  onClick={() => {
                    setError(null)
                    setReturnReason('')
                    setReturnTarget(o)
                  }}
                >
                  Оформить возврат
                </button>
              )}
            </div>
          </article>
        ))}
      </div>

      <Modal
        open={Boolean(returnTarget)}
        onClose={() => {
          if (returnOrder.isPending) return
          setReturnTarget(null)
          setReturnReason('')
        }}
        title="Полный возврат заказа"
        size="sm"
        footer={
          <div className="row wrap">
            <button
              className="btn btn-secondary"
              type="button"
              disabled={returnOrder.isPending}
              onClick={() => {
                setReturnTarget(null)
                setReturnReason('')
              }}
            >
              Отмена
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={returnOrder.isPending || returnReason.trim().length < 3}
              onClick={() => {
                if (!returnTarget) return
                returnOrder.mutate({ id: returnTarget.id, reason: returnReason.trim() })
              }}
            >
              Подтвердить возврат
            </button>
          </div>
        }
      >
        {returnTarget && (
          <div className="stack">
            <p>
              Заказ <strong>{returnTarget.order_number ?? returnTarget.id}</strong>
              {' · '}
              {formatMoney(returnTarget.total_minor)}
            </p>
            <p className="muted">
              Операция необратима: будет создано финансовое движение return_credit на полную сумму заказа.
              Повторный возврат этого заказа будет запрещён.
            </p>
            <div className="field">
              <label htmlFor="return-reason">Причина возврата</label>
              <textarea
                id="return-reason"
                rows={3}
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder="Кратко опишите причину"
                data-overlay-initial-focus
              />
            </div>
          </div>
        )}
      </Modal>
    </main>
  )
}
