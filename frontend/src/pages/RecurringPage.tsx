import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { ApiError, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useBuyerOrg, useSupplierOrg } from '@/shared/lib/commerce'
import { statusBadgeClass } from '@/shared/lib/status'
import { Hint } from '@/shared/ui/Hint'

type RecurringItem = { product_id: string; qty: number }
type ProposedChange = {
  origin?: string
  frequency?: string
  interval_weeks?: number
  qty?: number
  preferred_weekday?: number
  window_start_minute?: number
  window_end_minute?: number
  reason?: string
}
type Agreement = {
  id: string
  status: string
  frequency: string
  interval_weeks?: number
  start_date: string
  end_date?: string | null
  pickup_branch_id?: string
  preferred_weekday?: number | null
  window_start_minute?: number | null
  window_end_minute?: number | null
  items?: RecurringItem[]
  proposed_change?: ProposedChange
  exceptions?: Array<{ kind: string; message: string }>
}
type Product = { id: string; name: string; brand?: string }

const WEEKDAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота']

function minutesToTime(m?: number | null) {
  if (m == null) return '—'
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function timeToMinutes(v: string) {
  const [h, m] = v.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function frequencyLabel(freq: string, interval?: number) {
  if (freq === 'monthly') return 'Ежемесячно'
  if (freq === 'every_n_weeks') return `Каждые ${interval || 1} нед.`
  if (freq === 'biweekly') return 'Каждые 2 недели'
  return 'Еженедельно'
}

export function RecurringPage() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const { supplierOrgId, orgs: supplierOrgs } = useSupplierOrg()
  const { buyerOrgId, buyerOrg, orgs: buyerOrgs } = useBuyerOrg()
  const isSupplier = Boolean(supplierOrgId)
  const orgId = isSupplier ? supplierOrgId : buyerOrgId
  const role = isSupplier ? 'supplier' : 'buyer'

  const [frequency, setFrequency] = useState('every_n_weeks')
  const [intervalWeeks, setIntervalWeeks] = useState('3')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState('')
  const [weekday, setWeekday] = useState('1')
  const [windowStart, setWindowStart] = useState('10:00')
  const [windowEnd, setWindowEnd] = useState('18:00')
  const [branchId, setBranchId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [lines, setLines] = useState<Array<{ product_id: string; qty: string }>>([{ product_id: '', qty: '1' }])
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [proposeId, setProposeId] = useState<string | null>(null)
  const [proposeQty, setProposeQty] = useState('2')
  const [proposeWindow, setProposeWindow] = useState('12:00')
  const [proposeReason, setProposeReason] = useState('')
  const [reviseId, setReviseId] = useState<string | null>(null)
  const [reviseWeekday, setReviseWeekday] = useState('2')

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

  const pickupBranches = buyerOrg?.branches.filter((b) => b.pickup_enabled) ?? buyerOrg?.branches ?? []
  const pickupBranchId = useMemo(
    () => branchId || pickupBranches[0]?.id || '',
    [branchId, pickupBranches],
  )

  const create = useMutation({
    mutationFn: () => apiRequest('/v1/commerce/recurring', {
      token: accessToken,
      body: {
        supplier_org_id: supplierId,
        buyer_org_id: buyerOrgId,
        pickup_branch_id: pickupBranchId,
        frequency,
        interval_weeks: Number(intervalWeeks) || 3,
        preferred_weekday: Number(weekday),
        window_start_minute: timeToMinutes(windowStart),
        window_end_minute: timeToMinutes(windowEnd),
        start_date: startDate,
        end_date: endDate || undefined,
        horizon_days: 30,
        items: lines.filter((l) => l.product_id).map((l) => ({ product_id: l.product_id, qty: Number(l.qty) || 1 })),
      },
    }),
    onSuccess: async () => {
      setOk('Заявка на регулярную поставку создана')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['recurring'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось создать'),
  })

  const decide = useMutation({
    mutationFn: ({ id, action, ...rest }: Record<string, unknown> & { id: string; action: string }) =>
      apiRequest(`/v1/commerce/recurring/${id}/decide`, {
        token: accessToken,
        body: { action, ...rest },
      }),
    onSuccess: async () => {
      setOk('Решение сохранено')
      setError(null)
      setProposeId(null)
      setReviseId(null)
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
      <h1>Регулярные поставки <Hint id="recurring-flow" title="Регулярные поставки">Салон создаёт заявку, поставщик одобряет или предлагает изменения. После согласования заказы появляются на ближайший горизонт.</Hint></h1>
      <p className="muted">
        {isSupplier
          ? 'Заявки салонов. Одобрите, отклоните или предложите другие условия.'
          : 'Частота, филиал, окно доставки и несколько товаров в одном соглашении.'}
      </p>
      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}

      {!isSupplier && (
        <section className="card stack">
          <h2>Новая заявка</h2>
          <div className="field">
            <label htmlFor="sup">Поставщик</label>
            <select id="sup" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setLines([{ product_id: '', qty: '1' }]) }}>
              <option value="">Выберите…</option>
              {(suppliers.data?.items ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          {lines.map((line, idx) => (
            <div className="row" key={idx}>
              <div className="field" style={{ flex: 2 }}>
                <label>Товар {idx + 1}</label>
                <select data-testid={`recurring-product-${idx}`} value={line.product_id} disabled={!supplierId} onChange={(e) => setLines((cur) => cur.map((l, i) => i === idx ? { ...l, product_id: e.target.value } : l))}>
                  <option value="">Выберите…</option>
                  {(products.data?.items ?? []).map((p) => (
                    <option key={p.id} value={p.id}>{[p.brand, p.name].filter(Boolean).join(' · ')}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Кол-во</label>
                <input value={line.qty} onChange={(e) => setLines((cur) => cur.map((l, i) => i === idx ? { ...l, qty: e.target.value } : l))} />
              </div>
            </div>
          ))}
          <button className="btn btn-secondary btn-compact" type="button" disabled={lines.length >= 6} onClick={() => setLines((cur) => [...cur, { product_id: '', qty: '1' }])}>
            Добавить товар
          </button>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="freq">Частота</label>
              <select id="freq" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                <option value="weekly">Еженедельно</option>
                <option value="every_n_weeks">Каждые N недель</option>
                <option value="monthly">Ежемесячно</option>
              </select>
            </div>
            {frequency === 'every_n_weeks' && (
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="nweeks">Каждые N недель</label>
                <input id="nweeks" type="number" min={1} max={12} value={intervalWeeks} onChange={(e) => setIntervalWeeks(e.target.value)} />
              </div>
            )}
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="wd">День недели</label>
              <select id="wd" value={weekday} onChange={(e) => setWeekday(e.target.value)}>
                {WEEKDAYS.map((label, i) => <option key={i} value={String(i)}>{label}</option>)}
              </select>
            </div>
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="start">Старт</label>
              <input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="end">Окончание (необязательно)</label>
              <input id="end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="branch">Филиал</label>
              <select id="branch" value={pickupBranchId} onChange={(e) => setBranchId(e.target.value)}>
                {pickupBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
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
          <button
            className="btn btn-primary"
            type="button"
            disabled={create.isPending || !supplierId || lines.filter((l) => l.product_id).length < 1 || !pickupBranchId}
            onClick={() => create.mutate()}
          >
            Отправить заявку
          </button>
        </section>
      )}

      {(list.data?.items ?? []).length === 0 && <div className="empty-state"><h2>Заявок нет</h2></div>}
      <div className="list">
        {(list.data?.items ?? []).map((a) => (
          <article key={a.id} className="list-item stack-sm" data-testid={`recurring-${a.status}`}>
            <div className="row between">
              <strong>{frequencyLabel(a.frequency, a.interval_weeks)}</strong>
              <span className={`badge ${statusBadgeClass(a.status)}`}>
                {a.status === 'pending' ? 'Ожидает' : a.status === 'active' ? 'Активно' : a.status === 'paused' ? 'Пауза' : a.status === 'pending_reconfirm' ? 'Нужно подтверждение' : a.status === 'cancelled' ? 'Отменено' : a.status}
              </span>
            </div>
            <p className="muted">
              Старт {a.start_date}{a.end_date ? ` · до ${a.end_date}` : ''}
              {a.preferred_weekday != null ? ` · ${WEEKDAYS[a.preferred_weekday] ?? a.preferred_weekday}` : ''}
              {' · окно '}{minutesToTime(a.window_start_minute)}–{minutesToTime(a.window_end_minute)}
            </p>
            {(a.items ?? []).length > 0 && (
              <p>Товары: {(a.items ?? []).map((it) => `${it.qty} шт.`).join(', ')}</p>
            )}
            {(a.exceptions ?? []).filter((e) => e.kind).length > 0 && (
              <div className="state-box error">
                {(a.exceptions ?? []).map((e, i) => <p key={i}>{e.kind === 'price_change' ? 'Изменилась цена' : 'Товар недоступен'}: {e.message}</p>)}
              </div>
            )}
            {isSupplier && (a.status === 'pending' || a.status === 'active') && (
              <div className="row">
                {a.status === 'pending' && (
                  <>
                    <button className="btn btn-primary btn-compact" type="button" onClick={() => decide.mutate({ id: a.id, action: 'approve' })}>Одобрить</button>
                    <button className="btn btn-secondary btn-compact" type="button" onClick={() => decide.mutate({ id: a.id, action: 'reject' })}>Отклонить</button>
                  </>
                )}
                <button className="btn btn-secondary btn-compact" type="button" onClick={() => setProposeId(a.id)}>Предложить изменения</button>
                {a.status === 'active' && <button className="btn btn-secondary btn-compact" type="button" onClick={() => setStatus.mutate({ id: a.id, status: 'paused' })}>Пауза</button>}
              </div>
            )}
            {isSupplier && proposeId === a.id && (
              <div className="stack-sm">
                <div className="field"><label>Новое количество (для всех позиций)</label><input value={proposeQty} onChange={(e) => setProposeQty(e.target.value)} /></div>
                <div className="field"><label>Новое окно с</label><input type="time" value={proposeWindow} onChange={(e) => setProposeWindow(e.target.value)} /></div>
                <div className="field"><label>Комментарий</label><input value={proposeReason} onChange={(e) => setProposeReason(e.target.value)} /></div>
                <button className="btn btn-primary btn-compact" type="button" onClick={() => decide.mutate({
                  id: a.id, action: 'propose', qty: Number(proposeQty) || 1, reason: proposeReason,
                  window_start_minute: timeToMinutes(proposeWindow), frequency: a.frequency, interval_weeks: a.interval_weeks,
                })}>Отправить предложение</button>
              </div>
            )}
            {a.status === 'pending_reconfirm' && a.proposed_change && (
              <div className="stack-sm" data-testid="recurring-diff">
                <p><strong>Было → Предложено</strong></p>
                {a.proposed_change.qty != null && <p>Количество: {(a.items?.[0]?.qty ?? '—')} → {a.proposed_change.qty}</p>}
                {a.proposed_change.window_start_minute != null && (
                  <p>Окно с: {minutesToTime(a.window_start_minute)} → {minutesToTime(a.proposed_change.window_start_minute)}</p>
                )}
                {a.proposed_change.frequency && <p>Частота: {frequencyLabel(a.frequency, a.interval_weeks)} → {frequencyLabel(a.proposed_change.frequency, a.proposed_change.interval_weeks)}</p>}
                {a.proposed_change.preferred_weekday != null && <p>День: {WEEKDAYS[a.preferred_weekday ?? 0]} → {WEEKDAYS[a.proposed_change.preferred_weekday]}</p>}
                {a.proposed_change.reason && <p className="muted">{a.proposed_change.reason}</p>}
                {isSupplier === (a.proposed_change.origin === 'buyer') && (
                  <div className="row">
                    <button className="btn btn-primary btn-compact" type="button" onClick={() => decide.mutate({ id: a.id, action: 'accept_proposal' })}>Принять</button>
                    <button className="btn btn-secondary btn-compact" type="button" onClick={() => decide.mutate({ id: a.id, action: 'reject_proposal' })}>Отклонить</button>
                  </div>
                )}
              </div>
            )}
            {!isSupplier && a.status === 'active' && (
              <div className="row">
                <button className="btn btn-secondary btn-compact" type="button" onClick={() => setStatus.mutate({ id: a.id, status: 'paused' })}>Пауза</button>
                <button className="btn btn-secondary btn-compact" type="button" onClick={() => setReviseId(a.id)}>Изменить условия</button>
                <button className="btn btn-secondary btn-compact" type="button" onClick={() => setStatus.mutate({ id: a.id, status: 'cancelled' })}>Отменить</button>
              </div>
            )}
            {!isSupplier && reviseId === a.id && (
              <div className="stack-sm">
                <div className="field">
                  <label>Новый день недели</label>
                  <select value={reviseWeekday} onChange={(e) => setReviseWeekday(e.target.value)}>
                    {WEEKDAYS.map((label, i) => <option key={i} value={String(i)}>{label}</option>)}
                  </select>
                </div>
                <button className="btn btn-primary btn-compact" type="button" onClick={() => decide.mutate({ id: a.id, action: 'revise', preferred_weekday: Number(reviseWeekday) })}>
                  Отправить на подтверждение поставщику
                </button>
              </div>
            )}
            {!isSupplier && a.status === 'paused' && (
              <button className="btn btn-secondary btn-compact" type="button" onClick={() => setStatus.mutate({ id: a.id, status: 'active' })}>
                Возобновить
              </button>
            )}
            {isSupplier && a.status === 'paused' && (
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
