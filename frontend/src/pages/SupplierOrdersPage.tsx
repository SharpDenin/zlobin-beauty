import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  fetchBranch,
  paymentMethodLabel,
  useSupplierOrg,
  type OrderDelivery,
  type SupplierOrder,
} from '@/shared/lib/commerce'
import { formatMoney } from '@/shared/lib/money'
import {
  deliveryActionLabel,
  deliveryStatusLabel,
  paymentStatusLabel,
  statusBadgeClass,
  supplierOrderActionLabel,
  supplierOrderLabel,
} from '@/shared/lib/status'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { supplierOrderIsTerminal } from '@/pages/supplier-helpers'

/** Commercial order machine only — physical progress lives on Delivery. */
const nextCommercialStatus: Record<string, string> = {
  new: 'confirmed',
  submitted: 'confirmed',
  confirmed: 'picking',
  picking: 'ready_for_dispatch',
}

const nextDeliveryAction: Record<string, { path: string; labelKey: string }> = {
  pending: { path: 'preparing', labelKey: 'preparing' },
  scheduled: { path: 'preparing', labelKey: 'preparing' },
  preparing: { path: 'in-transit', labelKey: 'in_transit' },
  in_transit: { path: 'arrived', labelKey: 'arrived' },
  arrived: { path: 'delivered', labelKey: 'delivered' },
}

type ScheduleDraft = {
  date: string
  windowStart: string
  windowEnd: string
}

export function SupplierOrdersPage() {
  const { accessToken } = useAuth()
  const { supplierOrgId, supplierOrg, orgs } = useSupplierOrg()
  const qc = useQueryClient()
  const [scheduleDraft, setScheduleDraft] = useState<Record<string, ScheduleDraft>>({})
  const [error, setError] = useState<unknown>(null)
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
    mutationFn: (input: { id: string; status: string }) =>
      apiRequest(`/v1/commerce/supplier-orders/${input.id}/transition`, {
        token: accessToken,
        body: { status: input.status },
      }),
    onSuccess: async () => {
      setError(null)
      setOk('Статус заказа обновлён')
      await qc.invalidateQueries({ queryKey: ['commerce-supplier-orders'] })
      await qc.invalidateQueries({ queryKey: ['supplier-dashboard'] })
      await qc.invalidateQueries({ queryKey: ['order-delivery'] })
    },
    onError: (e) => setError(e),
  })

  const deliveryTransition = useMutation({
    mutationFn: (input: { id: string; path: string }) =>
      apiRequest(`/v1/commerce/supplier-orders/${input.id}/delivery/${input.path}`, {
        token: accessToken,
        method: 'POST',
      }),
    onSuccess: async () => {
      setOk('Статус доставки обновлён')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['order-delivery'] })
      await qc.invalidateQueries({ queryKey: ['commerce-supplier-orders'] })
    },
    onError: (e) => setError(e),
  })

  const markPaid = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/v1/commerce/supplier-orders/${id}/mark-paid`, {
        token: accessToken,
        method: 'POST',
      }),
    onSuccess: async () => {
      setOk('Оплата отмечена')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['commerce-supplier-orders'] })
    },
    onError: (e) => setError(e),
  })

  const scheduleDelivery = useMutation({
    mutationFn: async (input: { id: string; draft: ScheduleDraft; patch: boolean }) => {
      if (!input.draft.date) throw new ApiError('Укажите дату доставки', 'validation_error', 400)
      const planned = new Date(`${input.draft.date}T12:00:00`)
      const windowStart = input.draft.windowStart
        ? new Date(`${input.draft.date}T${input.draft.windowStart}:00`)
        : undefined
      const windowEnd = input.draft.windowEnd
        ? new Date(`${input.draft.date}T${input.draft.windowEnd}:00`)
        : undefined
      return apiRequest<OrderDelivery>(
        `/v1/commerce/supplier-orders/${input.id}/delivery/schedule`,
        {
          method: input.patch ? 'PATCH' : 'POST',
          token: accessToken,
          body: {
            planned_delivery_at: planned.toISOString(),
            window_start: windowStart?.toISOString() ?? null,
            window_end: windowEnd?.toISOString() ?? null,
          },
        },
      )
    },
    onSuccess: async () => {
      setOk('Доставка запланирована')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['order-delivery'] })
    },
    onError: (e) => setError(e),
  })

  if (orgs.isLoading) return <main className="page"><div className="skeleton skeleton-card" aria-busy="true" /></main>
  if (!supplierOrgId) {
    return (
      <main className="page">
        <EmptyState
          title="Сначала создайте поставщика"
          text="Онбординг откроет заказы салонов."
          action={<Link className="btn btn-primary" to="/supplier">Онбординг</Link>}
        />
      </main>
    )
  }

  return (
    <main className="page stack">
      <div className="row between">
        <div className="stack-sm">
          <h1>Заказы</h1>
          <p className="muted">{supplierOrg?.organization.name}</p>
          <p className="muted">Физическая доставка ведётся отдельно от статуса заказа.</p>
        </div>
        <Link className="btn btn-secondary btn-compact" to="/supplier">На главную</Link>
      </div>

      <ErrorBanner error={error} fallbackTitle="Не удалось обновить заказ" />
      {ok && <p className="muted" role="status">{ok}</p>}
      {orders.isLoading && (
        <div className="stack" aria-busy="true">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      )}
      {orders.isError && <ErrorBanner error={orders.error} fallbackTitle="Не удалось загрузить заказы" />}
      {orders.data && orders.data.items.length === 0 && (
        <EmptyState title="Пока нет заказов" text="Когда салоны оформят заказ, он появится здесь." />
      )}

      <div className="list">
        {orders.data?.items.map((o) => {
          const next = nextCommercialStatus[o.status]
          const actionLabel = next ? (supplierOrderActionLabel[next] ?? supplierOrderLabel(next)) : null
          const draft = scheduleDraft[o.id] ?? { date: '', windowStart: '10:00', windowEnd: '18:00' }
          const canMarkPaid = o.payment_status && o.payment_status !== 'paid' && o.payment_status !== 'cancelled'
          return (
            <article key={o.id} className={`history-card stack-sm${supplierOrderIsTerminal(o.status) ? ' is-terminal' : ''}`}>
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

              {o.destination_branch_id && (
                <DeliveryScheduleBlock
                  orderId={o.id}
                  token={accessToken}
                  draft={draft}
                  onDraftChange={(nextDraft) =>
                    setScheduleDraft((prev) => ({ ...prev, [o.id]: nextDraft }))
                  }
                  onSchedule={(patch) =>
                    scheduleDelivery.mutate({ id: o.id, draft, patch })
                  }
                  onDeliveryAction={(path) => deliveryTransition.mutate({ id: o.id, path })}
                  pending={scheduleDelivery.isPending || deliveryTransition.isPending}
                />
              )}

              <div className="row">
                {next && (
                  <button
                    className="btn btn-primary btn-compact"
                    type="button"
                    disabled={transition.isPending}
                    onClick={() => transition.mutate({ id: o.id, status: next })}
                  >
                    {actionLabel}
                  </button>
                )}
                {canMarkPaid && (
                  <button
                    className="btn btn-secondary btn-compact"
                    type="button"
                    disabled={markPaid.isPending}
                    onClick={() => markPaid.mutate(o.id)}
                  >
                    Отметить оплату
                  </button>
                )}
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
            </article>
          )
        })}
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

function DeliveryScheduleBlock({
  orderId,
  token,
  draft,
  onDraftChange,
  onSchedule,
  onDeliveryAction,
  pending,
}: {
  orderId: string
  token: string | null
  draft: ScheduleDraft
  onDraftChange: (d: ScheduleDraft) => void
  onSchedule: (patch: boolean) => void
  onDeliveryAction: (path: string) => void
  pending: boolean
}) {
  const delivery = useQuery({
    queryKey: ['order-delivery', orderId],
    queryFn: () =>
      apiRequest<OrderDelivery>(`/v1/commerce/supplier-orders/${orderId}/delivery`, {
        token,
      }),
    enabled: Boolean(token && orderId),
    retry: false,
  })

  const hasSchedule = Boolean(delivery.data?.planned_delivery_at || delivery.data?.window_start)
  const deliveryNext = delivery.data?.status ? nextDeliveryAction[delivery.data.status] : null

  return (
    <div className="stack-sm">
      {delivery.data && (
        <p>
          Доставка:{' '}
          <span className={`badge ${statusBadgeClass(delivery.data.status)}`}>
            {deliveryStatusLabel(delivery.data.status)}
          </span>
          {delivery.data.planned_delivery_at
            ? ` · ${new Date(delivery.data.planned_delivery_at).toLocaleDateString('ru-RU')}`
            : ''}
          {delivery.data.window_start && delivery.data.window_end
            ? ` · ${new Date(delivery.data.window_start).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}–${new Date(delivery.data.window_end).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
            : ''}
        </p>
      )}
      <div className="field">
        <label>Дата доставки</label>
        <input
          type="date"
          value={draft.date}
          onChange={(e) => onDraftChange({ ...draft, date: e.target.value })}
        />
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Окно с</label>
          <input
            type="time"
            value={draft.windowStart}
            onChange={(e) => onDraftChange({ ...draft, windowStart: e.target.value })}
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Окно до</label>
          <input
            type="time"
            value={draft.windowEnd}
            onChange={(e) => onDraftChange({ ...draft, windowEnd: e.target.value })}
          />
        </div>
      </div>
      <div className="row">
        <button
          className="btn btn-secondary btn-compact"
          type="button"
          disabled={pending || !draft.date}
          onClick={() => onSchedule(hasSchedule)}
        >
          {hasSchedule ? 'Обновить расписание' : 'Запланировать доставку'}
        </button>
        {deliveryNext && (
          <button
            className="btn btn-primary btn-compact"
            type="button"
            disabled={pending}
            onClick={() => onDeliveryAction(deliveryNext.path)}
          >
            {deliveryActionLabel[deliveryNext.labelKey] ?? deliveryNext.labelKey}
          </button>
        )}
      </div>
    </div>
  )
}
