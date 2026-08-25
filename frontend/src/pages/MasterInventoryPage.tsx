import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useBuyerOrg, type SupplierOrder } from '@/shared/lib/commerce'
import { statusBadgeClass, supplierOrderLabel } from '@/shared/lib/status'
import { formatQty, movementContext, movementDelta, movementTitle, remainingToAccept, acceptanceStateLabel, canCommitReceipt, discrepancyQty, receiptTotals, type InventoryItem, type InventoryMovement, type ReceiptOrder } from '@/pages/inventory-helpers'

type InventoryResponse = {
  location: { id: string; kind: string; owner_user_id?: string | null }
  items: InventoryItem[]
}

type ItemDetails = {
  location: { id: string }
  item: InventoryItem
  movements: InventoryMovement[]
}

export function MasterInventoryPage() {
  const { productId } = useParams()
  if (productId) return <MasterStockDetail productId={productId} />
  return <MasterStockList />
}

function MasterStockList() {
  const { accessToken } = useAuth()
  const { buyerOrgId, orgs } = useBuyerOrg()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')

  const inventory = useQuery({
    queryKey: ['me-inventory', buyerOrgId],
    queryFn: () =>
      apiRequest<InventoryResponse>(`/v1/me/inventory?organization_id=${buyerOrgId}`, { token: accessToken }),
    enabled: Boolean(accessToken && buyerOrgId),
  })
  const receipts = useQuery({
    queryKey: ['me-inventory-receipts', buyerOrgId],
    queryFn: () =>
      apiRequest<{ items: SupplierOrder[] }>(`/v1/me/inventory/receipts?organization_id=${buyerOrgId}`, { token: accessToken }),
    enabled: Boolean(accessToken && buyerOrgId),
  })

  const items = useMemo(() => {
    const all = inventory.data?.items ?? []
    const query = q.trim().toLowerCase()
    return all.filter((it) => {
      if (status && it.status !== status) return false
      if (!query) return true
      return [it.product_name, it.brand, it.sku].some((v) => (v || '').toLowerCase().includes(query))
    })
  }, [inventory.data, q, status])

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

  const pendingCount = receipts.data?.items.length ?? 0
  const empty = (inventory.data?.items.length ?? 0) === 0

  return (
    <main className="page stack">
      <div className="row between">
        <div className="stack-sm">
          <h1>Мой склад</h1>
          <p className="muted">Личные остатки. Не склад салона и не склад поставщика.</p>
        </div>
        <div className="row">
          <Link className="btn btn-secondary btn-compact" to="/inventory/receipts">На приёмке</Link>
          <Link className="btn btn-secondary btn-compact" to="/knowledge">База знаний</Link>
        </div>
      </div>

      {inventory.isError && <div className="state-box error">Не удалось загрузить склад</div>}

      <section className="card stack-sm">
        <div className="field">
          <label htmlFor="stock-search">Поиск</label>
          <input id="stock-search" data-testid="stock-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название, бренд, артикул" />
        </div>
        <div className="field">
          <label htmlFor="stock-status">Статус</label>
          <select id="stock-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Все</option>
            <option value="sufficient">Достаточно</option>
            <option value="low">Мало</option>
            <option value="critical">Критично</option>
            <option value="out">Нет</option>
          </select>
        </div>
      </section>

      {empty && pendingCount > 0 && (
        <div className="empty-state" data-testid="awaiting-delivery">
          <h2>Ожидается поставка</h2>
          <p>Товар ещё не принят. Откройте поставку и внесите фактическое количество на склад.</p>
          <Link className="btn btn-primary" to="/inventory/receipts">Поставки / На приёмке</Link>
        </div>
      )}
      {empty && pendingCount === 0 && (
        <div className="empty-state" data-testid="stock-empty">
          <h2>На складе пока ничего нет</h2>
          <p>Остаток появится после приёмки поставки.</p>
          <Link className="btn btn-primary" to="/cosmetics">Заказать косметику</Link>
        </div>
      )}

      <div className="list">
        {items.map((it) => (
          <Link key={it.product_id} className="history-card" to={`/inventory/${it.product_id}`} data-testid="stock-item">
            <div className="row between">
              <strong>{it.brand ? `${it.brand} ${it.product_name}` : it.product_name}</strong>
              <span className={`badge ${it.status === 'out' || it.status === 'critical' ? 'badge-danger' : 'badge-default'}`}>
                {formatQty(it.available, it.unit)}
              </span>
            </div>
            <p className="muted">{it.sku || 'Без артикула'}{it.volume_label ? ` · ${it.volume_label}` : ''}</p>
          </Link>
        ))}
      </div>
    </main>
  )
}

function MasterStockDetail({ productId }: { productId: string }) {
  const { accessToken } = useAuth()
  const { buyerOrgId } = useBuyerOrg()
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const [qty, setQty] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const details = useQuery({
    queryKey: ['me-inventory-item', buyerOrgId, productId],
    queryFn: () =>
      apiRequest<ItemDetails>(`/v1/me/inventory/${productId}?organization_id=${buyerOrgId}`, { token: accessToken }),
    enabled: Boolean(accessToken && buyerOrgId && productId),
  })

  const adjust = useMutation({
    mutationFn: () =>
      apiRequest('/v1/me/inventory/adjust', {
        token: accessToken,
        body: { organization_id: buyerOrgId, product_id: productId, qty: Number(qty), reason },
      }),
    onSuccess: async () => {
      setOk('Остаток скорректирован')
      setError(null)
      setQty('')
      setReason('')
      await qc.invalidateQueries({ queryKey: ['me-inventory'] })
      await qc.invalidateQueries({ queryKey: ['me-inventory-item', buyerOrgId, productId] })
    },
    onError: (e) => {
      setOk(null)
      setError(e instanceof ApiError ? e.message : 'Не удалось скорректировать')
    },
  })

  const item = details.data?.item
  const title = item ? (item.brand ? `${item.brand} ${item.product_name}` : item.product_name) : 'Товар'

  return (
    <main className="page stack">
      <div className="row between">
        <h1>{title}</h1>
        <Link className="btn btn-secondary btn-compact" to="/inventory">К складу</Link>
      </div>
      {details.isLoading && <div className="state-box">Загрузка…</div>}
      {details.isError && <div className="state-box error">Товар не найден</div>}
      {item && (
        <section className="card stack-sm" data-testid="stock-detail">
          <p className="muted">Текущий остаток</p>
          <strong data-testid="stock-available">{formatQty(item.available, item.unit)}</strong>
          <p className="muted">На руках {formatQty(item.qty_on_hand, item.unit)}{item.qty_reserved ? ` · резерв ${formatQty(item.qty_reserved, item.unit)}` : ''}</p>
        </section>
      )}
      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}

      <section className="card stack">
        <h2>История движения</h2>
        {(details.data?.movements.length ?? 0) === 0 && <p className="muted">Движений пока нет</p>}
        <div className="list">
          {details.data?.movements.map((m) => (
            <article key={m.id} className="history-card" data-testid="stock-movement">
              <div className="row between">
                <strong>{movementDelta(m.kind, m.qty)} {item ? formatQty(Math.abs(m.qty), item.unit).replace(/^-?[\d.]+ /, '') : ''}</strong>
                <span className="badge badge-default">{movementTitle(m.kind)}</span>
              </div>
              <p>{movementContext(m)}</p>
              {m.reason && m.reason !== movementContext(m) && <p className="muted">{m.reason}</p>}
              <p className="muted">
                {new Date(m.created_at).toLocaleString('ru-RU')}
                {m.actor_user_id ? ` · ${m.actor_user_id.slice(0, 8)}` : ''}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="card stack">
        <h2>Корректировка</h2>
        <p className="muted">Остаток нельзя править напрямую. Укажите дельту и причину.</p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            adjust.mutate()
          }}
        >
          <div className="field">
            <label htmlFor="adj-qty">Изменение количества</label>
            <input id="adj-qty" data-testid="adjust-qty" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="-10" />
          </div>
          <div className="field">
            <label htmlFor="adj-reason">Причина</label>
            <input id="adj-reason" data-testid="adjust-reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
          </div>
          <button className="btn btn-primary" type="submit" data-testid="adjust-submit" disabled={adjust.isPending || !reason.trim() || !qty}>
            Сохранить корректировку
          </button>
        </form>
      </section>
    </main>
  )
}

export function MasterReceiptsPage() {
  const { orderId } = useParams()
  if (orderId) return <ReceiptDetail orderId={orderId} />
  return <ReceiptList />
}

function ReceiptList() {
  const { accessToken } = useAuth()
  const { buyerOrgId, orgs } = useBuyerOrg()
  const [tab, setTab] = useState<'pending' | 'history'>('pending')

  const receipts = useQuery({
    queryKey: ['me-inventory-receipts', buyerOrgId, tab],
    queryFn: () =>
      apiRequest<{ items: ReceiptOrder[] }>(
        `/v1/me/inventory/receipts?organization_id=${buyerOrgId}${tab === 'history' ? '&history=1' : ''}`,
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

  const items = receipts.data?.items ?? []

  return (
    <main className="page stack">
      <div className="row between">
        <div className="stack-sm">
          <h1>Поставки / На приёмке</h1>
          <p className="muted">Принятое количество попадёт на личный склад. Повреждённое и брак — нет.</p>
        </div>
        <div className="row">
          <Link className="btn btn-secondary btn-compact" to="/inventory">Мой склад</Link>
          <Link className="btn btn-secondary btn-compact" to="/knowledge">База знаний</Link>
        </div>
      </div>
      <div className="row">
        <button className={`btn btn-compact ${tab === 'pending' ? 'btn-primary' : 'btn-secondary'}`} type="button" data-testid="receipts-pending-tab" onClick={() => setTab('pending')}>
          На приёмке
        </button>
        <button className={`btn btn-compact ${tab === 'history' ? 'btn-primary' : 'btn-secondary'}`} type="button" data-testid="receipts-history-tab" onClick={() => setTab('history')}>
          История поставок
        </button>
      </div>
      {receipts.isError && <div className="state-box error">Не удалось загрузить поставки</div>}
      {items.length === 0 && (
        <div className="empty-state" data-testid="receipts-empty">
          <h2>{tab === 'pending' ? 'Нет поставок на приёмке' : 'История пока пустая'}</h2>
          <p>{tab === 'pending' ? 'Когда заказ будет доставлен, он появится здесь.' : 'Принятые поставки появятся в истории.'}</p>
        </div>
      )}
      <div className="list">
        {items.map((o) => (
          <article key={o.id} className="history-card" data-testid={tab === 'history' ? 'receipt-history-item' : 'pending-receipt'}>
            <div className="row between">
              <strong>{o.comment || `Заказ #${o.id.slice(0, 8)}`}</strong>
              <span className={`badge ${statusBadgeClass(o.status)}`}>{supplierOrderLabel(o.status)}</span>
            </div>
            <p className="muted">Поставщик: {o.supplier_name || '—'}</p>
            <p className="muted">
              {new Date(o.created_at).toLocaleString('ru-RU')}
              {' · '}
              {(o.items?.length ?? 0)} позиций
              {' · '}
              {acceptanceStateLabel(o.acceptance_state)}
            </p>
            {(o.undelivered_qty ?? 0) > 0 && (
              <p className="muted">{o.undelivered_qty} не поступило</p>
            )}
            <Link className="btn btn-primary btn-compact" to={`/inventory/receipts/${o.id}`} data-testid="open-receipt">
              Открыть поставку
            </Link>
          </article>
        ))}
      </div>
    </main>
  )
}

function ReceiptDetail({ orderId }: { orderId: string }) {
  const { accessToken } = useAuth()
  const { buyerOrgId } = useBuyerOrg()

  const receipt = useQuery({
    queryKey: ['me-inventory-receipt', buyerOrgId, orderId],
    queryFn: () =>
      apiRequest<ReceiptOrder>(`/v1/me/inventory/receipts/${orderId}?organization_id=${buyerOrgId}`, { token: accessToken }),
    enabled: Boolean(accessToken && buyerOrgId && orderId),
  })

  const order = receipt.data

  return (
    <main className="page stack">
      <div className="row between">
        <h1>Приёмка поставки</h1>
        <Link className="btn btn-secondary btn-compact" to="/inventory/receipts">К поставкам</Link>
      </div>
      {receipt.isLoading && <div className="state-box">Загрузка…</div>}
      {receipt.isError && <div className="state-box error">Не удалось открыть поставку. Склад не изменён.</div>}
      {order && (
        <>
          <section className="card stack-sm" data-testid="receipt-header">
            <div className="row between">
              <strong>{order.comment || `Заказ #${order.id.slice(0, 8)}`}</strong>
              <span className={`badge ${statusBadgeClass(order.status)}`}>{supplierOrderLabel(order.status)}</span>
            </div>
            <p className="muted">Поставщик: {order.supplier_name || '—'}</p>
            <p className="muted">{new Date(order.created_at).toLocaleString('ru-RU')} · {(order.items?.length ?? 0)} позиций · {acceptanceStateLabel(order.acceptance_state)}</p>
            {(order.undelivered_qty ?? 0) > 0 && (
              <p data-testid="receipt-discrepancy">{order.undelivered_qty} не поступило</p>
            )}
          </section>
          {order.acceptance_state === 'completed' ? (
            <section className="card stack-sm" data-testid="receipt-completed">
              <h2>Приёмка завершена</h2>
              <p className="muted">Старую запись нельзя изменить. Если ошибка — сделайте корректировку на складе.</p>
              {(order.items ?? []).map((it) => (
                <article key={it.product_id} className="history-card">
                  <strong>{it.product_name || 'Товар'}</strong>
                  <p className="muted">
                    Заказано {it.qty_ordered} · принято {it.qty_accepted ?? 0} · повреждено {it.qty_damaged ?? 0} · отклонено {it.qty_rejected ?? 0}
                  </p>
                </article>
              ))}
            </section>
          ) : (
            <ReceiptAcceptForm order={order} token={accessToken} />
          )}
        </>
      )}
    </main>
  )
}

function ReceiptAcceptForm({
  order,
  token,
}: {
  order: ReceiptOrder
  token: string | null
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { buyerOrgId } = useBuyerOrg()
  const [reviewing, setReviewing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [idempotencyKey] = useState(() => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `accept-${Date.now()}`))
  const lines = order.items ?? []
  const [values, setValues] = useState<Record<string, { accepted: string; damaged: string; rejected: string; checked: boolean }>>(() => {
    const init: Record<string, { accepted: string; damaged: string; rejected: string; checked: boolean }> = {}
    for (const it of lines) {
      const remaining = it.remaining_qty ?? remainingToAccept(it.qty_ordered, it.qty_accepted ?? 0, it.qty_damaged ?? 0, it.qty_rejected ?? 0)
      init[it.product_id] = { accepted: remaining > 0 ? String(remaining) : '0', damaged: '0', rejected: '0', checked: false }
    }
    return init
  })

  const drafts = lines.map((it) => {
    const remaining = it.remaining_qty ?? remainingToAccept(it.qty_ordered, it.qty_accepted ?? 0, it.qty_damaged ?? 0, it.qty_rejected ?? 0)
    const v = values[it.product_id] ?? { accepted: '0', damaged: '0', rejected: '0', checked: false }
    return {
      remaining,
      accepted: Number(v.accepted) || 0,
      damaged: Number(v.damaged) || 0,
      rejected: Number(v.rejected) || 0,
      checked: v.checked,
    }
  })
  const totals = receiptTotals(drafts)
  const canCommit = canCommitReceipt(drafts)
  const overRemaining = drafts.some((d) => d.accepted + d.damaged + d.rejected > d.remaining + 1e-9)

  const accept = useMutation({
    mutationFn: () =>
      apiRequest(`/v1/commerce/supplier-orders/${order.id}/accept`, {
        token,
        body: {
          idempotency_key: idempotencyKey,
          items: lines
            .map((it) => {
              const v = values[it.product_id]
              return {
                product_id: it.product_id,
                qty_accepted: Number(v?.accepted || 0),
                qty_damaged: Number(v?.damaged || 0),
                qty_rejected: Number(v?.rejected || 0),
              }
            })
            .filter((it) => it.qty_accepted + it.qty_damaged + it.qty_rejected > 0),
        },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me-inventory'] })
      await qc.invalidateQueries({ queryKey: ['me-inventory-receipts'] })
      await qc.invalidateQueries({ queryKey: ['me-inventory-receipt', buyerOrgId, order.id] })
      await qc.invalidateQueries({ queryKey: ['commerce-supplier-orders'] })
      navigate('/inventory')
    },
    onError: (e) => {
      setReviewing(false)
      setError(e instanceof ApiError ? e.message : 'Не удалось принять поставку. Склад не изменён.')
    },
  })

  return (
    <div className="stack" data-testid="receipt-form">
      {error && <div className="state-box error" data-testid="receipt-error">{error}</div>}
      {lines.map((it) => {
        const remaining = it.remaining_qty ?? remainingToAccept(it.qty_ordered, it.qty_accepted ?? 0, it.qty_damaged ?? 0, it.qty_rejected ?? 0)
        const delivered = it.qty_delivered ?? 0
        const already = it.qty_accepted ?? 0
        const v = values[it.product_id] ?? { accepted: '0', damaged: '0', rejected: '0', checked: false }
        const missing = discrepancyQty(it.qty_ordered, delivered)
        return (
          <div key={it.product_id} className="card stack-sm" data-testid="receipt-item">
            <strong>{it.product_name || 'Товар'}</strong>
            <p className="muted">
              Заказано {it.qty_ordered}
              {' · '}Доставлено {delivered || '—'}
              {' · '}Уже принято {already}
              {' · '}Осталось принять {remaining}
            </p>
            {missing > 0 && <p className="muted">{missing} не поступило</p>}
            {remaining > 0 ? (
              <>
                <div className="field">
                  <label>Принято</label>
                  <input
                    data-testid="qty-accepted"
                    type="number"
                    min={0}
                    value={v.accepted}
                    onChange={(e) => setValues((prev) => ({ ...prev, [it.product_id]: { ...v, accepted: e.target.value } }))}
                  />
                </div>
                <div className="field">
                  <label>Повреждено</label>
                  <input
                    data-testid="qty-damaged"
                    type="number"
                    min={0}
                    value={v.damaged}
                    onChange={(e) => setValues((prev) => ({ ...prev, [it.product_id]: { ...v, damaged: e.target.value } }))}
                  />
                </div>
                <div className="field">
                  <label>Отклонено</label>
                  <input
                    data-testid="qty-rejected"
                    type="number"
                    min={0}
                    value={v.rejected}
                    onChange={(e) => setValues((prev) => ({ ...prev, [it.product_id]: { ...v, rejected: e.target.value } }))}
                  />
                </div>
                <label className="field-check">
                  <input
                    type="checkbox"
                    data-testid="item-checked"
                    checked={v.checked}
                    onChange={(e) => setValues((prev) => ({ ...prev, [it.product_id]: { ...v, checked: e.target.checked } }))}
                  />
                  <span>Проверено</span>
                </label>
              </>
            ) : (
              <p className="muted">По этой позиции принимать нечего.</p>
            )}
          </div>
        )
      })}
      <section className="card stack-sm" data-testid="receipt-totals">
        <p><strong>В склад: {totals.stockIn}</strong></p>
        <p className="muted">Не поступило / повреждено / отклонено: {totals.notStock}</p>
        <p className="muted">Принято {totals.accepted} · повреждено {totals.damaged} · отклонено {totals.rejected}</p>
      </section>
      {overRemaining && <div className="state-box error">Сумма по позиции больше оставшегося количества. Склад не изменён.</div>}
      {reviewing && (
        <section className="card stack-sm" data-testid="receipt-summary">
          <h2>Подтверждение</h2>
          <p>В склад попадёт только принятое: {totals.stockIn}</p>
          <p className="muted">Повреждено {totals.damaged} · отклонено {totals.rejected}. Эти количества не станут остатком.</p>
          <button
            className="btn btn-primary"
            type="button"
            data-testid="confirm-receipt"
            disabled={accept.isPending}
            onClick={() => accept.mutate()}
          >
            Подтвердить
          </button>
        </section>
      )}
      <button
        className="btn btn-primary"
        type="button"
        data-testid="commit-receipt"
        disabled={!canCommit || overRemaining || accept.isPending}
        onClick={() => setReviewing(true)}
      >
        Внести всё в склад
      </button>
    </div>
  )
}

export function AppointmentMaterialsForm({
  appointmentId,
  orgId,
}: {
  appointmentId: string
  orgId?: string
}) {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const { buyerOrgId } = useBuyerOrg()
  const resolvedOrg = orgId || buyerOrgId
  const [productId, setProductId] = useState('')
  const [qty, setQty] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [txId] = useState(() => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `consume-${Date.now()}`))

  const inventory = useQuery({
    queryKey: ['me-inventory', resolvedOrg],
    queryFn: () =>
      apiRequest<InventoryResponse>(`/v1/me/inventory?organization_id=${resolvedOrg}`, { token: accessToken }),
    enabled: Boolean(accessToken && resolvedOrg),
  })

  const consume = useMutation({
    mutationFn: () =>
      apiRequest('/v1/me/inventory/consume', {
        token: accessToken,
        body: {
          organization_id: resolvedOrg,
          product_id: productId,
          qty: Number(qty),
          appointment_id: appointmentId,
          idempotency_key: `${txId}:${productId}`,
          reason: 'расход по услуге',
        },
      }),
    onSuccess: async () => {
      setOk('Списано со склада')
      setError(null)
      setQty('')
      await qc.invalidateQueries({ queryKey: ['me-inventory'] })
      await qc.invalidateQueries({ queryKey: ['inventory-availability'] })
    },
    onError: (e) => {
      setOk(null)
      setError(e instanceof ApiError ? e.message : 'Недостаточно товара на складе')
    },
  })

  const items = inventory.data?.items ?? []

  return (
    <section className="card stack" data-testid="used-materials">
      <h2>Использованные материалы</h2>
      <p className="muted">Списание только после подтверждения. Формула не рассчитывается автоматически.</p>
      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}
      {items.length === 0 && <p className="muted">На складе пока ничего нет</p>}
      {items.length > 0 && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            consume.mutate()
          }}
        >
          <div className="field">
            <label htmlFor="mat-product">Товар</label>
            <select id="mat-product" data-testid="consume-product" value={productId} onChange={(e) => setProductId(e.target.value)} required>
              <option value="">Выберите товар</option>
              {items.map((it) => (
                <option key={it.product_id} value={it.product_id}>
                  {it.brand ? `${it.brand} ` : ''}{it.product_name} · {formatQty(it.available, it.unit)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="mat-qty">Количество</label>
            <input id="mat-qty" data-testid="consume-qty" value={qty} onChange={(e) => setQty(e.target.value)} required />
          </div>
          <button className="btn btn-primary" type="submit" data-testid="consume-submit" disabled={consume.isPending || !productId || !qty}>
            Списать со склада
          </button>
        </form>
      )}
    </section>
  )
}
