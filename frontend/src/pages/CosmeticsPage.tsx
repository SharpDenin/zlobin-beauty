import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/shared/lib/money'
import { statusBadgeClass, statusLabel } from '@/shared/lib/status'

type OrgItem = {
  organization: { id: string; name: string; type: string }
}

type Location = { id: string; name: string; kind: string }

type Product = {
  id: string
  brand: string
  name: string
  price_minor: number
  unit: string
  volume_label: string
  published: boolean
}

type CartLine = { product: Product; qty: number }

type SupplierOrder = {
  id: string
  status: string
  total_minor: number
  supplier_org_id: string
  estimated_delivery_at?: string | null
  created_at: string
  comment?: string
}

export function CosmeticsPage() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [supplierOrgId, setSupplierOrgId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [comment, setComment] = useState('')

  const orgs = useQuery({
    queryKey: ['orgs-mine'],
    queryFn: () => apiRequest<{ items: OrgItem[] }>('/v1/organizations/mine', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const buyerOrg = (orgs.data?.items ?? []).find((i) => i.organization.type !== 'supplier')
    ?? orgs.data?.items[0]
  const buyerOrgId = buyerOrg?.organization.id

  const locations = useQuery({
    queryKey: ['commerce-locations', buyerOrgId],
    queryFn: () =>
      apiRequest<{ items: Location[] }>(`/v1/commerce/locations?organization_id=${buyerOrgId}`, {
        token: accessToken,
      }),
    enabled: Boolean(accessToken && buyerOrgId),
  })

  useEffect(() => {
    if (!locationId && locations.data?.items[0]?.id) {
      setLocationId(locations.data.items[0].id)
    }
  }, [locationId, locations.data])

  const ensureLocation = useMutation({
    mutationFn: async (): Promise<{ id?: string }> => {
      if (!buyerOrgId) throw new ApiError('Сначала создайте салон', 'validation_error', 400)
      return apiRequest<{ id?: string }>('/v1/commerce/locations', {
        token: accessToken,
        body: { organization_id: buyerOrgId, name: 'Основной склад', kind: 'salon' },
      })
    },
    onSuccess: async (res) => {
      setOk('Склад создан')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['commerce-locations'] })
      if (res.id) setLocationId(res.id)
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Ошибка склада'),
  })

  const supplierTrimmed = supplierOrgId.trim()
  const products = useQuery({
    queryKey: ['commerce-products', supplierTrimmed],
    queryFn: () =>
      apiRequest<{ items: Product[] }>(
        `/v1/commerce/products?organization_id=${encodeURIComponent(supplierTrimmed)}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && supplierTrimmed.length >= 32),
  })

  const orders = useQuery({
    queryKey: ['commerce-supplier-orders', 'buyer', buyerOrgId],
    queryFn: () =>
      apiRequest<{ items: SupplierOrder[] }>(
        `/v1/commerce/supplier-orders?organization_id=${buyerOrgId}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && buyerOrgId),
  })

  const createOrder = useMutation({
    mutationFn: () => {
      if (!buyerOrgId) throw new ApiError('Нет организации салона', 'validation_error', 400)
      if (!locationId) throw new ApiError('Выберите или создайте склад', 'validation_error', 400)
      if (!supplierTrimmed) throw new ApiError('Укажите UUID поставщика', 'validation_error', 400)
      if (cart.length === 0) throw new ApiError('Корзина пуста', 'validation_error', 400)
      return apiRequest('/v1/commerce/supplier-orders', {
        token: accessToken,
        body: {
          buyer_org_id: buyerOrgId,
          supplier_org_id: supplierTrimmed,
          location_id: locationId,
          comment: comment.trim() || 'Заказ косметики',
          items: cart.map((c) => ({ product_id: c.product.id, qty: c.qty })),
        },
      })
    },
    onSuccess: async () => {
      setOk('Заказ поставщику создан')
      setError(null)
      setCart([])
      setComment('')
      await qc.invalidateQueries({ queryKey: ['commerce-supplier-orders'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Ошибка заказа'),
  })

  const cartTotal = useMemo(
    () => cart.reduce((sum, line) => sum + line.product.price_minor * line.qty, 0),
    [cart],
  )

  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev.find((p) => p.product.id === product.id)
      if (existing) {
        return prev.map((p) => (p.product.id === product.id ? { ...p, qty: p.qty + 1 } : p))
      }
      return [...prev, { product, qty: 1 }]
    })
  }

  function setQty(productId: string, qty: number) {
    setCart((prev) => {
      if (qty <= 0) return prev.filter((p) => p.product.id !== productId)
      return prev.map((p) => (p.product.id === productId ? { ...p, qty } : p))
    })
  }

  if (orgs.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>
  if (!buyerOrgId) {
    return (
      <main className="page">
        <div className="state-box">Сначала создайте салон в кабинете мастера</div>
      </main>
    )
  }

  const activeLoc = locationId || locations.data?.items[0]?.id || ''

  return (
    <main className="page stack">
      <h1>Косметика</h1>
      <p className="muted">Заказ продукции у поставщика для салона «{buyerOrg?.organization.name}»</p>
      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}

      <section className="card stack">
        <h2>Склад доставки</h2>
        {locations.data && locations.data.items.length === 0 && (
          <button
            className="btn btn-primary"
            type="button"
            disabled={ensureLocation.isPending}
            onClick={() => ensureLocation.mutate()}
          >
            Создать основной склад
          </button>
        )}
        {locations.data && locations.data.items.length > 0 && (
          <div className="field">
            <label htmlFor="loc">Склад</label>
            <select id="loc" value={activeLoc} onChange={(e) => setLocationId(e.target.value)}>
              {locations.data.items.map((l) => (
                <option key={l.id} value={l.id}>{l.name} ({l.kind})</option>
              ))}
            </select>
          </div>
        )}
      </section>

      <section className="card stack">
        <h2>Каталог поставщика</h2>
        <p className="muted">
          Укажите UUID организации поставщика (после seed в логе будет
          {' '}<code>demo supplier_org_id=…</code>).
        </p>
        <div className="field">
          <label htmlFor="supplier_org_id">UUID организации поставщика</label>
          <input
            id="supplier_org_id"
            value={supplierOrgId}
            onChange={(e) => setSupplierOrgId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          />
        </div>
        {products.isLoading && <div className="state-box">Загрузка товаров…</div>}
        {products.isError && <div className="state-box error">Не удалось загрузить товары поставщика</div>}
        {products.data && products.data.items.length === 0 && (
          <div className="state-box">У поставщика нет опубликованных товаров</div>
        )}
        <div className="list">
          {products.data?.items.filter((p) => p.published).map((p) => (
            <article key={p.id} className="list-item">
              <div className="row between">
                <strong>{p.brand} {p.name}</strong>
                <span>{formatMoney(p.price_minor)}</span>
              </div>
              <p className="muted">{p.volume_label || p.unit}</p>
              <button className="btn btn-secondary btn-compact" type="button" onClick={() => addToCart(p)}>
                В корзину
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="card stack">
        <h2>Корзина</h2>
        {cart.length === 0 && <div className="state-box">Корзина пуста</div>}
        <div className="list">
          {cart.map((line) => (
            <article key={line.product.id} className="list-item">
              <div className="row between">
                <strong>{line.product.brand} {line.product.name}</strong>
                <span>{formatMoney(line.product.price_minor * line.qty)}</span>
              </div>
              <div className="field">
                <label>Количество</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={line.qty}
                  onChange={(e) => setQty(line.product.id, Number(e.target.value))}
                />
              </div>
            </article>
          ))}
        </div>
        {cart.length > 0 && (
          <>
            <p>Итого: <strong>{formatMoney(cartTotal)}</strong></p>
            <div className="field">
              <label htmlFor="order_comment">Комментарий</label>
              <input id="order_comment" value={comment} onChange={(e) => setComment(e.target.value)} />
            </div>
            <button
              className="btn btn-primary btn-block"
              type="button"
              disabled={createOrder.isPending || !activeLoc}
              onClick={() => createOrder.mutate()}
            >
              Создать заказ
            </button>
          </>
        )}
      </section>

      <section className="card stack">
        <h2>Мои заказы поставщикам</h2>
        {orders.isLoading && <div className="state-box">Загрузка…</div>}
        {orders.data && orders.data.items.length === 0 && (
          <div className="state-box">Заказов пока нет</div>
        )}
        <div className="list">
          {orders.data?.items.map((o) => (
            <article key={o.id} className="list-item">
              <div className="row between">
                <strong>{formatMoney(o.total_minor)}</strong>
                <span className={`badge ${statusBadgeClass(o.status)}`}>{statusLabel(o.status)}</span>
              </div>
              <p className="muted">{new Date(o.created_at).toLocaleString('ru-RU')}</p>
              {o.estimated_delivery_at && (
                <p>Ожидаемая доставка: {new Date(o.estimated_delivery_at).toLocaleString('ru-RU')}</p>
              )}
              {o.comment && <p>{o.comment}</p>}
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
