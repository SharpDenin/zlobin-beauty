import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/shared/lib/money'
import { clientOrderLabel, statusBadgeClass } from '@/shared/lib/status'

type OrgItem = {
  organization: { id: string; name: string; type: string }
}

type Dashboard = {
  turnover_minor: number
  orders_count: number
  products_count: number
  critical_stock_count: number
  turnover_delta_percent?: number | null
}

type ClientOrderRow = {
  id: string
  status: string
  total_minor: number
  created_at: string
}

function periodISO(days: number): { from: string; to: string } {
  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)
  return { from: from.toISOString(), to: to.toISOString() }
}

function formatDelta(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return 'н/д'
  if (!Number.isFinite(v)) return 'н/д'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}%`
}

const nextStatus: Record<string, string> = {
  submitted: 'confirmed',
  confirmed: 'picking',
  picking: 'in_delivery',
}

export function SupplierDashboardPage() {
  const { accessToken, user } = useAuth()
  const [days, setDays] = useState(7)
  const range = useMemo(() => periodISO(days), [days])
  const qc = useQueryClient()
  const [actionError, setActionError] = useState<string | null>(null)

  const orgs = useQuery({
    queryKey: ['orgs-mine'],
    queryFn: () => apiRequest<{ items: OrgItem[] }>('/v1/organizations/mine', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const supplierOrgs = (orgs.data?.items ?? []).filter((i) => i.organization.type === 'supplier')
  const [selectedOrgId, setSelectedOrgId] = useState<string>('')
  const orgId = selectedOrgId || supplierOrgs[0]?.organization.id

  const [createError, setCreateError] = useState<string | null>(null)
  const [createName, setCreateName] = useState('')
  const [createCity, setCreateCity] = useState('')
  const [createAddress, setCreateAddress] = useState('')
  const [createPhone, setCreatePhone] = useState('')

  const createSupplier = useMutation({
    mutationFn: async () => {
      const res = await apiRequest<{ organization: { id: string }; branch: { id: string } }>('/v1/organizations', {
        token: accessToken,
        body: {
          name: createName.trim(),
          branch_name: 'Склад',
          city: createCity.trim(),
          address_line: createAddress.trim(),
          type: 'supplier',
        },
      })
      if (createPhone.trim() && res.branch?.id) {
        await apiRequest(`/v1/branches/${res.branch.id}`, {
          method: 'PATCH',
          token: accessToken,
          body: { phone: createPhone.trim() },
        })
      }
      return res
    },
    onSuccess: async (res) => {
      setCreateError(null)
      setSelectedOrgId(res.organization.id)
      await qc.invalidateQueries({ queryKey: ['orgs-mine'] })
    },
    onError: (e) => setCreateError(e instanceof ApiError ? e.message : 'Не удалось создать поставщика'),
  })

  const firstSupplierId = supplierOrgs[0]?.organization.id
  useEffect(() => {
    if (!selectedOrgId && firstSupplierId) {
      setSelectedOrgId(firstSupplierId)
    }
  }, [selectedOrgId, firstSupplierId])

  const dash = useQuery({
    queryKey: ['supplier-dashboard', orgId, range.from, range.to],
    queryFn: () =>
      apiRequest<Dashboard>(
        `/v1/commerce/supplier/dashboard?organization_id=${orgId}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && orgId),
  })

  const clientOrders = useQuery({
    queryKey: ['supplier-client-orders', orgId],
    queryFn: () =>
      apiRequest<{ items: ClientOrderRow[] }>(
        `/v1/commerce/shop/supplier/orders?organization_id=${orgId}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && orgId),
  })

  const transition = useMutation({
    mutationFn: (input: { id: string; status: string; assignMe?: boolean }) =>
      apiRequest(`/v1/commerce/shop/supplier/orders/${input.id}/transition`, {
        token: accessToken,
        body: {
          status: input.status,
          ...(input.assignMe && user?.id ? { rep_user_id: user.id } : {}),
        },
      }),
    onSuccess: async () => {
      setActionError(null)
      await qc.invalidateQueries({ queryKey: ['supplier-client-orders'] })
    },
    onError: (e) => setActionError(e instanceof ApiError ? e.message : 'Ошибка статуса'),
  })

  if (orgs.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>
  if (!orgId) {
    return (
      <main className="page stack">
        <h1>Онбординг поставщика</h1>
        <p className="muted">Создайте организацию типа supplier — затем добавьте товары на складе и публикуйте каталог.</p>
        {createError && <div className="state-box error">{createError}</div>}
        <section className="card stack">
          <div className="field">
            <label htmlFor="sup-name">Название</label>
            <input id="sup-name" value={createName} onChange={(e) => setCreateName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="sup-city">Город</label>
            <input id="sup-city" value={createCity} onChange={(e) => setCreateCity(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="sup-address">Адрес склада</label>
            <input id="sup-address" value={createAddress} onChange={(e) => setCreateAddress(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="sup-phone">Телефон</label>
            <input id="sup-phone" value={createPhone} onChange={(e) => setCreatePhone(e.target.value)} />
          </div>
          <button
            className="btn btn-primary"
            type="button"
            disabled={createSupplier.isPending || !createName.trim() || !createCity.trim() || !createAddress.trim()}
            onClick={() => createSupplier.mutate()}
          >
            Создать поставщика
          </button>
        </section>
        <p className="muted">Салон создаётся отдельно в <Link to="/master">кабинете мастера</Link>.</p>
      </main>
    )
  }

  return (
    <main className="page stack">
      <h1>Панель поставщика</h1>
      {supplierOrgs.length > 1 && (
        <div className="field">
          <label htmlFor="sup-org">Организация</label>
          <select id="sup-org" value={orgId} onChange={(e) => setSelectedOrgId(e.target.value)}>
            {supplierOrgs.map((o) => (
              <option key={o.organization.id} value={o.organization.id}>{o.organization.name}</option>
            ))}
          </select>
        </div>
      )}
      <p>
        Оборот = сумма принятых позиций за период − возвраты. Сравнение с прошлым равным периодом;
        при нулевой базе — «н/д».
      </p>

      <div className="row">
        {[7, 30, 90].map((d) => (
          <button key={d} type="button" className={`btn ${days === d ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDays(d)}>
            {d} дн.
          </button>
        ))}
        <Link className="btn btn-secondary" to="/warehouse">Склад и товары</Link>
        <Link className="btn btn-secondary" to="/rep">Доставки</Link>
      </div>

      {dash.isLoading && <div className="state-box">Считаем показатели…</div>}
      {dash.isError && <div className="state-box error">Не удалось загрузить панель</div>}
      {dash.data && (
        <div className="kpi-grid">
          <article className="card">
            <p className="muted">Оборот</p>
            <strong>{formatMoney(dash.data.turnover_minor)}</strong>
            <p className="muted">к пред. периоду: {formatDelta(dash.data.turnover_delta_percent)}</p>
          </article>
          <article className="card">
            <p className="muted">Заказов</p>
            <strong>{dash.data.orders_count}</strong>
          </article>
          <article className="card">
            <p className="muted">Товаров в каталоге</p>
            <strong>{dash.data.products_count}</strong>
          </article>
          <article className="card">
            <p className="muted">Критические остатки</p>
            <strong>{dash.data.critical_stock_count}</strong>
          </article>
        </div>
      )}

      <section className="card stack">
        <h2>Клиентские заказы магазина</h2>
        {actionError && <div className="state-box error">{actionError}</div>}
        {clientOrders.isLoading && <div className="state-box">Загрузка…</div>}
        {clientOrders.data && clientOrders.data.items.length === 0 && (
          <div className="state-box">Заказов из магазина пока нет</div>
        )}
        <div className="list">
          {clientOrders.data?.items.map((o) => {
            const next = nextStatus[o.status]
            return (
              <article key={o.id} className="list-item">
                <div className="row between">
                  <strong>{formatMoney(o.total_minor)}</strong>
                  <span className={`badge ${statusBadgeClass(o.status)}`}>{clientOrderLabel(o.status)}</span>
                </div>
                <p className="muted">{new Date(o.created_at).toLocaleString('ru-RU')}</p>
                <div className="row">
                  {next && (
                    <button
                      className="btn btn-primary btn-compact"
                      type="button"
                      disabled={transition.isPending}
                      onClick={() =>
                        transition.mutate({
                          id: o.id,
                          status: next,
                          assignMe: next === 'in_delivery',
                        })
                      }
                    >
                      → {clientOrderLabel(next)}
                      {next === 'in_delivery' ? ' (назначить меня)' : ''}
                    </button>
                  )}
                  {(o.status === 'submitted' || o.status === 'confirmed') && (
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
      </section>
    </main>
  )
}
