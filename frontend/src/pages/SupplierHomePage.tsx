import { Link } from 'react-router-dom'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useSupplierOrg } from '@/shared/lib/commerce'
import { formatMoney } from '@/shared/lib/money'

type Dashboard = {
  turnover_minor: number
  orders_count: number
  products_count: number
  critical_stock_count: number
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

  const dash = useQuery({
    queryKey: ['supplier-dashboard', supplierOrgId],
    queryFn: () => {
      const to = new Date()
      const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000)
      return apiRequest<Dashboard>(
        `/v1/commerce/supplier/dashboard?organization_id=${supplierOrgId}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
        { token: accessToken },
      )
    },
    enabled: Boolean(accessToken && supplierOrgId),
  })

  const orders = useQuery({
    queryKey: ['commerce-supplier-orders', 'supplier', supplierOrgId, 'home'],
    queryFn: () =>
      apiRequest<{ items: Array<{ id: string; status: string }> }>(
        `/v1/commerce/supplier-orders?organization_id=${supplierOrgId}&role=supplier`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && supplierOrgId),
  })

  const products = useQuery({
    queryKey: ['commerce-products', supplierOrgId, 'home'],
    queryFn: () =>
      apiRequest<{ items: Array<{ id: string; published: boolean; for_sale?: boolean }> }>(
        `/v1/commerce/products?organization_id=${supplierOrgId}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && supplierOrgId),
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
            <div className="brand">Zlobin Beauty</div>
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

  return (
    <main className="page stack">
      <section className="hero">
        <div className="stack">
          <div className="brand">Zlobin Beauty</div>
          <h1>{supplierOrg?.organization.name || user?.display_name}</h1>
          <p>Новые заказы салонов и каталог товаров.</p>
          <div className="row">
            <Link className="btn btn-primary" to="/supplier/products/new">Новый товар</Link>
            <Link className="btn btn-secondary" to="/supplier/orders">Заказы</Link>
          </div>
        </div>
      </section>

      {supplierOrgs.length > 1 && (
        <p className="muted">Активная организация: {supplierOrg?.organization.name}</p>
      )}

      <div className="tile-grid">
        <Link className="dashboard-tile" to="/supplier/orders">
          <span className="muted">Новые заказы</span>
          <strong>
            {(orders.data?.items ?? []).filter((o) => o.status === 'new' || o.status === 'submitted').length}
          </strong>
          <span className="muted">ждут обработки</span>
        </Link>
        <Link className="dashboard-tile" to="/supplier/products">
          <span className="muted">В продаже</span>
          <strong>
            {(products.data?.items ?? []).filter((p) => p.published && p.for_sale !== false).length
              || dash.data?.products_count
              || 0}
          </strong>
          <span className="muted">товаров</span>
        </Link>
        <div className="dashboard-tile">
          <span className="muted">Оборот за неделю</span>
          <strong>{dash.data ? formatMoney(dash.data.turnover_minor) : '—'}</strong>
        </div>
        <div className="dashboard-tile">
          <span className="muted">Критические остатки</span>
          <strong>{dash.data?.critical_stock_count ?? '—'}</strong>
        </div>
      </div>
    </main>
  )
}
