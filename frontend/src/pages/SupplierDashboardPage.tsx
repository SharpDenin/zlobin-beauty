import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/shared/lib/money'
import { statusBadgeClass, statusLabel } from '@/shared/lib/status'

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

type Product = {
  id: string
  brand: string
  name: string
  sku: string
  unit: string
  volume_label: string
  price_minor: number
  min_stock: number
  published: boolean
}

type SupplierOrder = {
  id: string
  status: string
  total_minor: number
  buyer_org_id: string
  estimated_delivery_at?: string | null
  created_at: string
  comment?: string
  items?: Array<{ product_id: string; qty_ordered: number; price_minor: number }>
}

const productSchema = z.object({
  name: z.string().min(2),
  brand: z.string().optional(),
  sku: z.string().optional(),
  price_rubles: z.coerce.number().min(0),
  min_stock: z.coerce.number().min(0),
  unit: z.string().min(1),
  volume_label: z.string().optional(),
})

const nextB2BStatus: Record<string, string> = {
  new: 'confirmed',
  confirmed: 'picking',
  picking: 'in_transit',
  in_transit: 'delivered',
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

export function SupplierDashboardPage() {
  const { accessToken } = useAuth()
  const [days, setDays] = useState(7)
  const range = useMemo(() => periodISO(days), [days])
  const qc = useQueryClient()
  const [actionError, setActionError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [deliveryDraft, setDeliveryDraft] = useState<Record<string, string>>({})

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

  const products = useQuery({
    queryKey: ['commerce-products', orgId],
    queryFn: () =>
      apiRequest<{ items: Product[] }>(`/v1/commerce/products?organization_id=${orgId}`, { token: accessToken }),
    enabled: Boolean(accessToken && orgId),
  })

  const b2bOrders = useQuery({
    queryKey: ['commerce-supplier-orders', 'supplier', orgId],
    queryFn: () =>
      apiRequest<{ items: SupplierOrder[] }>(
        `/v1/commerce/supplier-orders?organization_id=${orgId}&role=supplier`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && orgId),
  })

  const productForm = useForm<z.infer<typeof productSchema>>({
    resolver: zodResolver(productSchema),
    defaultValues: { unit: 'pcs', price_rubles: 0, min_stock: 5 },
  })

  const createProduct = useMutation({
    mutationFn: (v: z.infer<typeof productSchema>) =>
      apiRequest('/v1/commerce/products', {
        token: accessToken,
        body: {
          organization_id: orgId,
          name: v.name,
          brand: v.brand ?? '',
          sku: v.sku ?? '',
          unit: v.unit,
          volume_label: v.volume_label ?? '',
          price_minor: Math.round(v.price_rubles * 100),
          min_stock: v.min_stock,
          published: true,
        },
      }),
    onSuccess: async () => {
      setOk('Товар создан')
      setActionError(null)
      productForm.reset({ name: '', brand: '', sku: '', unit: 'pcs', volume_label: '', price_rubles: 0, min_stock: 5 })
      await qc.invalidateQueries({ queryKey: ['commerce-products'] })
      await qc.invalidateQueries({ queryKey: ['supplier-dashboard'] })
    },
    onError: (e) => setActionError(e instanceof ApiError ? e.message : 'Ошибка товара'),
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
      setActionError(null)
      setOk('Статус заказа обновлён')
      await qc.invalidateQueries({ queryKey: ['commerce-supplier-orders'] })
      await qc.invalidateQueries({ queryKey: ['supplier-dashboard'] })
    },
    onError: (e) => setActionError(e instanceof ApiError ? e.message : 'Ошибка статуса'),
  })

  if (orgs.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>
  if (!orgId) {
    return (
      <main className="page stack">
        <h1>Онбординг поставщика</h1>
        <p className="muted">Создайте организацию типа supplier — затем добавьте товары и обрабатывайте заказы салонов.</p>
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

      {actionError && <div className="state-box error">{actionError}</div>}
      {ok && <div className="state-box success">{ok}</div>}

      <div className="row">
        {[7, 30, 90].map((d) => (
          <button key={d} type="button" className={`btn ${days === d ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDays(d)}>
            {d} дн.
          </button>
        ))}
      </div>

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
        <h2>B2B-заказы салонов</h2>
        {b2bOrders.isLoading && <div className="state-box">Загрузка…</div>}
        {b2bOrders.data && b2bOrders.data.items.length === 0 && (
          <div className="state-box">Заказов от салонов пока нет</div>
        )}
        <div className="list">
          {b2bOrders.data?.items.map((o) => {
            const next = nextB2BStatus[o.status]
            return (
              <article key={o.id} className="list-item stack-sm">
                <div className="row between">
                  <strong>{formatMoney(o.total_minor)}</strong>
                  <span className={`badge ${statusBadgeClass(o.status)}`}>{statusLabel(o.status)}</span>
                </div>
                <p className="muted">{new Date(o.created_at).toLocaleString('ru-RU')}</p>
                {o.estimated_delivery_at && (
                  <p>Доставка: {new Date(o.estimated_delivery_at).toLocaleString('ru-RU')}</p>
                )}
                {o.comment && <p>{o.comment}</p>}
                {next && (
                  <div className="stack-sm">
                    {(next === 'in_transit' || next === 'confirmed') && (
                      <div className="field">
                        <label>Ожидаемая доставка</label>
                        <input
                          type="datetime-local"
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
                        → {statusLabel(next)}
                      </button>
                      {(o.status === 'new' || o.status === 'confirmed') && (
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
      </section>

      <section className="card stack">
        <h2>Товары</h2>
        <form className="stack" onSubmit={productForm.handleSubmit((v) => createProduct.mutate(v))}>
          <div className="field"><label>Название</label><input {...productForm.register('name')} /></div>
          <div className="field"><label>Бренд</label><input {...productForm.register('brand')} /></div>
          <div className="field"><label>Артикул</label><input {...productForm.register('sku')} /></div>
          <div className="field"><label>Ед. изм.</label><input {...productForm.register('unit')} /></div>
          <div className="field"><label>Объём</label><input {...productForm.register('volume_label')} placeholder="100 мл" /></div>
          <div className="field"><label>Цена, ₽</label><input type="number" {...productForm.register('price_rubles')} /></div>
          <div className="field"><label>Мин. остаток</label><input type="number" {...productForm.register('min_stock')} /></div>
          <button className="btn btn-primary btn-block" type="submit" disabled={createProduct.isPending}>
            Добавить товар
          </button>
        </form>
        {products.isLoading && <div className="state-box">Загрузка…</div>}
        {products.data && products.data.items.length === 0 && <div className="state-box">Товаров пока нет</div>}
        <div className="list">
          {products.data?.items.map((p) => (
            <article key={p.id} className="list-item">
              <div className="row between">
                <strong>{p.brand} {p.name}</strong>
                <span>{formatMoney(p.price_minor)}</span>
              </div>
              <p className="muted">
                {p.sku ? `${p.sku} · ` : ''}
                {p.volume_label || p.unit}
                {p.published ? '' : ' · черновик'}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
