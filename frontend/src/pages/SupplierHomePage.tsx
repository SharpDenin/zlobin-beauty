import { Link } from 'react-router-dom'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useSupplierOrg } from '@/shared/lib/commerce'
import { formatMoney } from '@/shared/lib/money'

type Analytics = {
  revenue_today_minor?: number
  revenue_month_minor?: number
  revenue_quarter_minor?: number
  orders_today?: number
  orders_month?: number
  average_order_value_minor?: number
  unpaid_orders?: number
  unpaid_minor?: number
  deliveries_today?: number
  deliveries_count?: number
}

type Rep = {
  id: string
  display_name?: string
  city?: string
  tasks_overdue?: number
  open_tasks?: number
}

export function SupplierHomePage() {
  const { accessToken, user } = useAuth()
  const qc = useQueryClient()
  const { supplierOrg, supplierOrgId, supplierOrgs, orgs } = useSupplierOrg()
  const [createName, setCreateName] = useState('')
  const [createCity, setCreateCity] = useState('')
  const [createAddress, setCreateAddress] = useState('')
  const [createPhone, setCreatePhone] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  const analytics = useQuery({
    queryKey: ['supplier-analytics', supplierOrgId, 'home'],
    queryFn: () => apiRequest<Analytics>(`/v1/commerce/supplier/analytics?organization_id=${supplierOrgId}&period=month`, { token: accessToken }),
    enabled: Boolean(accessToken && supplierOrgId),
  })
  const reps = useQuery({
    queryKey: ['supplier-reps', supplierOrgId],
    queryFn: () => apiRequest<{ items: Rep[] }>(`/v1/organizations/${supplierOrgId}/representatives`, { token: accessToken }),
    enabled: Boolean(accessToken && supplierOrgId),
  })
  const sub = useQuery({
    queryKey: ['me-subscription'],
    queryFn: () =>
      apiRequest<{ status: string; trial_ends_at?: string }>('/v1/me/subscription', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

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
    onSuccess: async () => {
      setCreateError(null)
      await qc.invalidateQueries({ queryKey: ['orgs-mine'] })
    },
    onError: (e) => setCreateError(e instanceof ApiError ? e.message : 'Не удалось создать поставщика'),
  })

  if (orgs.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>

  if (!supplierOrgId) {
    return (
      <main className="page stack">
        <section className="hero">
          <div className="stack">
            <div className="brand">Salon-X</div>
            <h1>Профиль поставщика</h1>
            <p>Создайте организацию, чтобы публиковать товары для салонов.</p>
          </div>
        </section>
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
            className="btn btn-primary btn-block"
            type="button"
            disabled={createSupplier.isPending || !createName.trim() || !createCity.trim() || !createAddress.trim()}
            onClick={() => createSupplier.mutate()}
          >
            Создать поставщика
          </button>
        </section>
      </main>
    )
  }

  const a = analytics.data
  const overdue = (reps.data?.items ?? []).filter((r) => (r.tasks_overdue ?? 0) > 0)
  const kpis = [
    { label: 'Выручка сегодня', value: formatMoney(a?.revenue_today_minor ?? 0) },
    { label: 'Выручка за месяц', value: formatMoney(a?.revenue_month_minor ?? 0) },
    { label: 'Выручка за квартал', value: formatMoney(a?.revenue_quarter_minor ?? 0) },
    { label: 'Заказы сегодня', value: String(a?.orders_today ?? 0) },
    { label: 'Заказы за месяц', value: String(a?.orders_month ?? 0) },
    { label: 'Средний чек', value: formatMoney(a?.average_order_value_minor ?? 0) },
    { label: 'Ожидает оплаты', value: `${a?.unpaid_orders ?? 0} · ${formatMoney(a?.unpaid_minor ?? 0)}` },
    { label: 'Доставок сегодня', value: String(a?.deliveries_today ?? 0) },
  ]

  return (
    <main className="page stack">
      <section className="hero">
        <div className="stack">
          <p className="eyebrow">Поставщик</p>
          <h1>{supplierOrg?.organization.name || user?.display_name}</h1>
          <p>Состояние бизнеса прямо сейчас: заказы, оплаты и полевая команда.</p>
          {sub.data?.status === 'trial' && sub.data.trial_ends_at && (
            <p><strong>Premium активирован бесплатно на 3 месяца</strong> · до {new Date(sub.data.trial_ends_at).toLocaleDateString('ru-RU')}</p>
          )}
          <div className="row">
            <Link className="btn btn-primary" to="/supplier/analytics">Аналитика</Link>
            <Link className="btn btn-secondary" to="/supplier/team">Представители</Link>
            <Link className="btn btn-secondary" to="/supplier/orders">Заказы</Link>
          </div>
        </div>
      </section>

      {supplierOrgs.length > 1 && (
        <p className="muted">Активная организация: {supplierOrg?.organization.name}</p>
      )}

      <div className="kpi-grid">
        {kpis.map((k, i) => (
          <article key={k.label} className={`card stack-sm ${[0, 3, 6, 7].includes(i) ? '' : 'kpi-desktop-only'}`}>
            <span className="muted">{k.label}</span>
            <strong>{k.value}</strong>
          </article>
        ))}
      </div>

      {overdue.length > 0 && (
        <section className="card stack">
          <h2>Нужно внимание</h2>
          {overdue.map((r) => (
            <article key={r.id} className="list-item row between">
              <div>
                <strong>{r.display_name || r.city || 'Представитель'}</strong>
                <p className="muted">{r.tasks_overdue} просроченных задач</p>
              </div>
              <Link to={`/supplier/team/${r.id}`}>Открыть</Link>
            </article>
          ))}
        </section>
      )}

      <div className="tile-grid">
        <Link className="dashboard-tile" to="/supplier/orders">
          <span className="muted">Заказы</span>
          <strong>{a?.orders_today ?? 0}</strong>
          <span className="muted">сегодня</span>
        </Link>
        <Link className="dashboard-tile" to="/supplier/team">
          <span className="muted">Команда</span>
          <strong>{reps.data?.items.length ?? 0}</strong>
          <span className="muted">представителей</span>
        </Link>
        <Link className="dashboard-tile" to="/warehouse">
          <span className="muted">Склад</span>
          <strong>Остатки</strong>
          <span className="muted">доступно · резерв · в пути</span>
        </Link>
        <Link className="dashboard-tile" to="/supplier/analytics">
          <span className="muted">Выручка месяца</span>
          <strong>{formatMoney(a?.revenue_month_minor ?? 0)}</strong>
        </Link>
      </div>
    </main>
  )
}
