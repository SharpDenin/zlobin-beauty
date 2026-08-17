import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { ApiError, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useBuyerOrg, useSupplierOrg } from '@/shared/lib/commerce'
import { statusBadgeClass } from '@/shared/lib/status'

type Agreement = {
  id: string
  status: string
  frequency: string
  start_date: string
  supplier_org_id?: string
  buyer_org_id?: string
  preferred_weekday?: number | null
  window_start_minute?: number | null
  window_end_minute?: number | null
  proposed_change?: { frequency?: string; start_date?: string; qty?: number; reason?: string }
}

type Product = { id: string; name: string; brand?: string }

export function RecurringPage() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const { supplierOrgId, orgs: supplierOrgs } = useSupplierOrg()
  const { buyerOrgId, buyerOrg, orgs: buyerOrgs } = useBuyerOrg()
  const isSupplier = Boolean(supplierOrgId)
  const orgId = isSupplier ? supplierOrgId : buyerOrgId
  const role = isSupplier ? 'supplier' : 'buyer'

  const [frequency, setFrequency] = useState('weekly')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [weekday, setWeekday] = useState('1')
  const [windowStart, setWindowStart] = useState('10:00')
  const [windowEnd, setWindowEnd] = useState('18:00')
  const [supplierId, setSupplierId] = useState('')
  const [productId, setProductId] = useState('')
  const [qty, setQty] = useState('1')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [proposeId, setProposeId] = useState<string | null>(null)
  const [proposeQty, setProposeQty] = useState('1')
  const [proposeReason, setProposeReason] = useState('')

  const list = useQuery({
    queryKey: ['recurring', orgId, role],
    queryFn: () =>
      apiRequest<{ items: Agreement[] }>(
        `/v1/commerce/recurring?organization_id=${orgId}&role=${role}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && orgId),
  })

  const suppliers = useQuery({
    queryKey: ['suppliers-public'],
    queryFn: () => apiRequest<{ items: Array<{ id: string; name: string }> }>('/v1/suppliers', { token: accessToken }),
    enabled: Boolean(accessToken && !isSupplier),
  })

  const products = useQuery({
    queryKey: ['supplier-catalog', supplierId],
    queryFn: () =>
      apiRequest<{ items: Product[] }>(`/v1/commerce/products?organization_id=${encodeURIComponent(supplierId)}`, {
        token: accessToken,
      }),
    enabled: Boolean(accessToken && supplierId && !isSupplier),
  })

  const pickupBranchId = useMemo(
    () => buyerOrg?.branches.find((b) => b.pickup_enabled)?.id ?? buyerOrg?.branches[0]?.id ?? '',
    [buyerOrg],
  )

  const create = useMutation({
    mutationFn: () => {
      const [sh, sm] = windowStart.split(':').map(Number)
      const [eh, em] = windowEnd.split(':').map(Number)
      return apiRequest('/v1/commerce/recurring', {
        token: accessToken,
        body: {
          supplier_org_id: supplierId,
          buyer_org_id: buyerOrgId,
          pickup_branch_id: pickupBranchId,
          frequency,
          preferred_weekday: Number(weekday),
          window_start_minute: (sh || 0) * 60 + (sm || 0),
          window_end_minute: (eh || 18) * 60 + (em || 0),
          start_date: startDate,
          horizon_days: 30,
          items: [{ product_id: productId, qty: Number(qty) || 1 }],
        },
      })
    },
    onSuccess: async () => {
      setOk('Заявка на регулярную поставку создана')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['recurring'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось создать'),
  })

  const decide = useMutation({
    mutationFn: (input: { id: string; action: string; qty?: number; reason?: string; frequency?: string }) =>
      apiRequest(`/v1/commerce/recurring/${input.id}/decide`, {
        token: accessToken,
        body: {
          action: input.action,
          qty: input.qty,
          reason: input.reason,
          frequency: input.frequency,
        },
      }),
    onSuccess: async () => {
      setOk('Решение сохранено')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['recurring'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Ошибка'),
  })

  const setStatus = useMutation({
    mutationFn: (input: { id: string; status: string }) =>
      apiRequest(`/v1/commerce/recurring/${input.id}/status`, {
        token: accessToken,
        body: { status: input.status },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['recurring'] })
    },
  })

  if (supplierOrgs.isLoading || buyerOrgs.isLoading) {
    return <main className="page"><div className="state-box">Загрузка…</div></main>
  }
  if (!orgId) {
    return <main className="page"><div className="empty-state"><h2>Нужна организация</h2></div></main>
  }

  return (
    <main className="page stack">
      <h1>Регулярные поставки</h1>
      <p className="muted">
        {isSupplier
          ? 'Заявки салонов. После одобрения создаются заказы на ближайший горизонт.'
          : 'Заявка салона поставщику: частота, филиал самовывоза и состав.'}
      </p>
      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}

      {!isSupplier && (
        <section className="card stack">
          <h2>Новая заявка</h2>
          <div className="field">
            <label htmlFor="sup">Поставщик</label>
            <select
              id="sup"
              value={supplierId}
              onChange={(e) => {
                setSupplierId(e.target.value)
                setProductId('')
              }}
            >
              <option value="">Выберите…</option>
              {(suppliers.data?.items ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="prod">Товар</label>
            <select id="prod" value={productId} onChange={(e) => setProductId(e.target.value)} disabled={!supplierId}>
              <option value="">Выберите…</option>
              {(products.data?.items ?? []).map((p) => (
                <option key={p.id} value={p.id}>{[p.brand, p.name].filter(Boolean).join(' · ')}</option>
              ))}
            </select>
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="freq">Частота</label>
              <select id="freq" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                <option value="weekly">Еженедельно</option>
                <option value="biweekly">Каждые 2 недели</option>
                <option value="monthly">Ежемесячно</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="wd">День недели</label>
              <select id="wd" value={weekday} onChange={(e) => setWeekday(e.target.value)}>
                <option value="1">Понедельник</option>
                <option value="2">Вторник</option>
                <option value="3">Среда</option>
                <option value="4">Четверг</option>
                <option value="5">Пятница</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="qty">Кол-во</label>
              <input id="qty" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="start">Старт</label>
              <input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Окно с</label>
              <input type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Окно до</label>
              <input type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
            </div>
          </div>
          <p className="muted">Филиал получения: {pickupBranchId ? 'выбран из филиалов салона' : 'нет филиала'}</p>
          <button
            className="btn btn-primary"
            type="button"
            disabled={create.isPending || !supplierId || !productId || !pickupBranchId}
            onClick={() => create.mutate()}
          >
            Отправить заявку
          </button>
        </section>
      )}

      {(list.data?.items ?? []).length === 0 && <div className="empty-state"><h2>Заявок нет</h2></div>}
      <div className="list">
        {(list.data?.items ?? []).map((a) => (
          <article key={a.id} className="list-item stack-sm">
            <div className="row between">
              <strong>{a.frequency === 'weekly' ? 'Еженедельно' : a.frequency === 'monthly' ? 'Ежемесячно' : 'Раз в две недели'}</strong>
              <span className={`badge ${statusBadgeClass(a.status)}`}>
                {a.status === 'pending' ? 'Ожидает' : a.status === 'active' ? 'Активно' : a.status === 'paused' ? 'Пауза' : a.status}
              </span>
            </div>
            <p className="muted">Старт {a.start_date}</p>
            {isSupplier && a.status === 'pending' && (
              <div className="row">
                <button className="btn btn-primary btn-compact" type="button" onClick={() => decide.mutate({ id: a.id, action: 'approve' })}>Одобрить</button>
                <button className="btn btn-secondary btn-compact" type="button" onClick={() => decide.mutate({ id: a.id, action: 'reject' })}>Отклонить</button>
                <button className="btn btn-secondary btn-compact" type="button" onClick={() => setProposeId(a.id)}>Предложить изменения</button>
              </div>
            )}
            {isSupplier && proposeId === a.id && (
              <div className="stack-sm">
                <div className="field"><label>Новое количество</label><input value={proposeQty} onChange={(e) => setProposeQty(e.target.value)} /></div>
                <div className="field"><label>Причина</label><input value={proposeReason} onChange={(e) => setProposeReason(e.target.value)} /></div>
                <button className="btn btn-primary btn-compact" type="button" onClick={() => decide.mutate({ id: a.id, action: 'propose', qty: Number(proposeQty) || 1, reason: proposeReason, frequency: a.frequency })}>Отправить предложение</button>
              </div>
            )}
            {!isSupplier && a.status === 'pending_reconfirm' && (
              <div className="stack-sm">
                <p>Предложение поставщика: {a.proposed_change?.qty ? `кол-во ${a.proposed_change.qty}` : ''} {a.proposed_change?.frequency || ''} {a.proposed_change?.reason || ''}</p>
                <div className="row">
                  <button className="btn btn-primary btn-compact" type="button" onClick={() => decide.mutate({ id: a.id, action: 'accept_proposal' })}>Принять</button>
                  <button className="btn btn-secondary btn-compact" type="button" onClick={() => decide.mutate({ id: a.id, action: 'reject_proposal' })}>Отклонить</button>
                </div>
              </div>
            )}
            {!isSupplier && a.status === 'active' && (
              <div className="row">
                <button className="btn btn-secondary btn-compact" type="button" onClick={() => setStatus.mutate({ id: a.id, status: 'paused' })}>Пауза</button>
                <button className="btn btn-secondary btn-compact" type="button" onClick={() => setStatus.mutate({ id: a.id, status: 'cancelled' })}>Отменить</button>
              </div>
            )}
            {!isSupplier && a.status === 'paused' && (
              <button className="btn btn-secondary btn-compact" type="button" onClick={() => setStatus.mutate({ id: a.id, status: 'active' })}>
                Возобновить
              </button>
            )}
          </article>
        ))}
      </div>
    </main>
  )
}
