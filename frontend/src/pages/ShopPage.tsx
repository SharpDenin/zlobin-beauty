import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { CircleMarker, MapContainer, TileLayer } from 'react-leaflet'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/shared/lib/money'
import { clientOrderLabel, paymentStatusLabel, statusBadgeClass } from '@/shared/lib/status'
import { fetchPickupBranches, type BranchCard, type SupplierCard } from '@/shared/lib/commerce'
import { MediaImage } from '@/shared/ui/MediaImage'
import { Hint } from '@/shared/ui/Hint'
import { CHART } from '@/shared/ui/chart-theme'
import 'leaflet/dist/leaflet.css'

type ShopProduct = {
  id: string
  organization_id: string
  brand: string
  name: string
  description: string
  sku: string
  unit: string
  volume_label: string
  price_minor: number
  available: number
  published: boolean
  photo_media_id?: string | null
  category?: string
  category_id?: string | null
  audience?: string
  variants?: ShopProduct[]
}

type CartItem = {
  product_id: string
  qty: number
  brand: string
  name: string
  price_minor: number
  current_price_minor?: number
  price_changed?: boolean
  available: number
  line_total_minor: number
  unit: string
  organization_id?: string
}

type Cart = {
  id: string
  items: CartItem[]
  total_minor: number
  multi_supplier?: boolean
}

type OrderHistoryEntry = {
  from_status: string
  to_status: string
  created_at: string
  note?: string
}

type CheckoutResult = {
  checkout_group_id?: string
  total_minor: number
  orders: ClientOrder[]
  order?: ClientOrder
}

type ClientOrder = {
  id: string
  order_number?: string
  status: string
  total_minor: number
  delivery_address: string
  payment_method?: string
  payment_status?: string
  pickup_branch_id?: string | null
  created_at: string
  items?: Array<{ product_name: string; brand: string; qty: number; price_minor: number }>
  status_history?: OrderHistoryEntry[]
}

type Category = { id: string; name: string; slug?: string }
type KnowledgeCard = {
  id: string
  title: string
  category: string
  cover_media_id?: string | null
  reading_time_minutes?: number
}

type SortKey = 'default' | 'price_asc' | 'price_desc' | 'name'

const PAYMENTS = [
  { value: 'cash', label: 'Оплата при получении' },
  { value: 'bank_transfer', label: 'Банковский перевод' },
  { value: 'card', label: 'Картой онлайн' },
] as const

function paymentLabel(method?: string) {
  const normalized = method === 'cash_on_delivery' ? 'cash' : method
  return PAYMENTS.find((p) => p.value === normalized)?.label ?? 'При получении'
}

function shopPaymentStatus(order: ClientOrder) {
  if (order.payment_status) return paymentStatusLabel(order.payment_status)
  if (order.status === 'cancelled') return 'Отменён'
  if (order.status === 'delivered') return 'Оплачено'
  return 'Ожидает оплаты'
}

function branchLabel(b: BranchCard) {
  return [b.city, b.name, b.address_line].filter(Boolean).join(' · ')
}

function branchAddress(b: BranchCard) {
  return [b.city, b.address_line, b.name].filter(Boolean).join(', ')
}

export function ShopPage() {
  const loc = useLocation()
  const { id, orderId } = useParams()
  if (loc.pathname === '/shop/cart') return <CartView />
  if (loc.pathname === '/shop/checkout/success') return <CheckoutSuccessView />
  if (loc.pathname === '/shop/checkout') return <CheckoutView />
  if (loc.pathname === '/shop/orders' || loc.pathname === '/orders') return <OrdersView />
  if (orderId) return <OrderDetailView id={orderId} />
  if (id) return <ProductView id={id} />
  return <CatalogView />
}

function ShopChrome({
  title,
  eyebrow = 'Клиент',
  children,
}: {
  title: string
  eyebrow?: string
  children?: ReactNode
}) {
  const { accessToken } = useAuth()
  const loc = useLocation()
  const cart = useQuery({
    queryKey: ['shop-cart'],
    queryFn: () => apiRequest<Cart>('/v1/commerce/shop/cart', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const count = cart.data?.items?.length ?? 0
  return (
    <div className="stack-sm shop-chrome">
      <p className="eyebrow">{eyebrow}</p>
      <div className="row between shop-head">
        <h1>{title}</h1>
        {children}
      </div>
      <div className="row shop-tabs">
        <Link className={`btn ${loc.pathname === '/shop' ? 'btn-primary' : 'btn-secondary'}`} to="/shop">
          Каталог
        </Link>
        <Link className={`btn ${loc.pathname === '/shop/cart' || loc.pathname === '/shop/checkout' ? 'btn-primary' : 'btn-secondary'}`} to="/shop/cart">
          Корзина{count ? ` (${count})` : ''}
        </Link>
        <Link className={`btn ${loc.pathname === '/shop/orders' || loc.pathname === '/orders' ? 'btn-primary' : 'btn-secondary'}`} to="/orders">
          Мои заказы
        </Link>
      </div>
    </div>
  )
}

function ProductCard({
  product,
  token,
  categoryName,
  onAdd,
  busy,
}: {
  product: ShopProduct
  token: string | null
  categoryName?: string
  onAdd: () => void
  busy?: boolean
}) {
  return (
    <article className="product-card shop-product-card">
      <Link to={`/shop/${product.id}`} className="shop-product-media">
        {product.photo_media_id ? (
          <MediaImage mediaId={product.photo_media_id} token={token} alt={product.name} className="product-photo" />
        ) : (
          <div className="product-photo placeholder">{product.brand || 'Salon-X'}</div>
        )}
      </Link>
      <p className="muted shop-product-meta">
        {[product.brand, categoryName, product.volume_label || product.unit].filter(Boolean).join(' · ')}
      </p>
      <Link to={`/shop/${product.id}`}><strong>{product.name}</strong></Link>
      <div className="row between">
        <span className="shop-price">{formatMoney(product.price_minor)}</span>
        <span className={`badge ${product.available > 0 ? 'badge-confirmed' : 'badge-default'}`}>
          {product.available > 0 ? 'В наличии' : 'Нет'}
        </span>
      </div>
      <div className="row">
        <Link className="btn btn-secondary btn-compact" to={`/shop/${product.id}`}>Подробнее</Link>
        <button
          className="btn btn-primary btn-compact"
          type="button"
          disabled={product.available <= 0 || busy}
          onClick={onAdd}
        >
          В корзину
        </button>
      </div>
    </article>
  )
}

function CatalogView() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [brand, setBrand] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [sort, setSort] = useState<SortKey>('default')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const products = useQuery({
    queryKey: ['shop-products', search, brand],
    queryFn: () =>
      apiRequest<{ items: ShopProduct[] }>(
        `/v1/commerce/shop/products?q=${encodeURIComponent(search)}&brand=${encodeURIComponent(brand)}&limit=80`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken),
  })
  const categories = useQuery({
    queryKey: ['shop-categories'],
    queryFn: () => apiRequest<{ items: Category[] }>('/v1/commerce/product-categories', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const recommendations = useQuery({
    queryKey: ['shop-recommendations'],
    queryFn: () =>
      apiRequest<{ items: Array<{ id: string; comment: string; product: ShopProduct }> }>(
        '/v1/commerce/shop/recommendations',
        { token: accessToken },
      ),
    enabled: Boolean(accessToken),
  })

  const addToCart = useMutation({
    mutationFn: (product_id: string) =>
      apiRequest<Cart>('/v1/commerce/shop/cart/items', {
        method: 'PUT',
        token: accessToken,
        body: { product_id, qty: 1 },
      }),
    onSuccess: async () => {
      setOk('Товар в корзине')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['shop-cart'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось добавить'),
  })

  const catName = useMemo(
    () => Object.fromEntries((categories.data?.items ?? []).map((c) => [c.id, c.name])),
    [categories.data],
  )
  const brands = useMemo(() => {
    const set = new Set((products.data?.items ?? []).map((p) => p.brand).filter(Boolean))
    return [...set].sort((a, b) => a.localeCompare(b, 'ru'))
  }, [products.data])
  const usedCategories = useMemo(() => {
    const ids = new Set((products.data?.items ?? []).map((p) => p.category_id).filter(Boolean) as string[])
    return (categories.data?.items ?? []).filter((c) => ids.has(c.id))
  }, [products.data, categories.data])

  const filtered = useMemo(() => {
    let items = products.data?.items ?? []
    if (categoryId) items = items.filter((p) => p.category_id === categoryId)
    if (sort === 'price_asc') items = [...items].sort((a, b) => a.price_minor - b.price_minor)
    if (sort === 'price_desc') items = [...items].sort((a, b) => b.price_minor - a.price_minor)
    if (sort === 'name') items = [...items].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    return items
  }, [products.data, categoryId, sort])

  const recs = recommendations.data?.items ?? []

  return (
    <main className="page stack shop-page">
      <ShopChrome title="Магазин">
        <Hint id="shop-home" title="Магазин">Только розничные товары. Самовывоз в салоне — ближайший пункт предлагается автоматически.</Hint>
      </ShopChrome>

      <form
        className="shop-search"
        onSubmit={(e) => {
          e.preventDefault()
          setSearch(q.trim())
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по названию или бренду"
          aria-label="Поиск"
        />
        <button className="btn btn-primary" type="submit">Найти</button>
      </form>

      <div className="shop-filters">
        <label className="field">
          <span>Бренд</span>
          <select value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">Все бренды</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Категория</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Все категории</option>
            {usedCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Сортировка</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="default">По умолчанию</option>
            <option value="price_asc">Цена ↑</option>
            <option value="price_desc">Цена ↓</option>
            <option value="name">Название</option>
          </select>
        </label>
      </div>
      <div className="chip-row">
        <button type="button" className={`chip ${!categoryId ? 'active' : ''}`} onClick={() => setCategoryId('')}>Все</button>
        {usedCategories.map((c) => (
          <button key={c.id} type="button" className={`chip ${categoryId === c.id ? 'active' : ''}`} onClick={() => setCategoryId(c.id)}>
            {c.name}
          </button>
        ))}
      </div>

      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}

      {recs.length > 0 && !search && !brand && !categoryId && (
        <section className="stack-sm">
          <h2>Рекомендации мастеров</h2>
          <div className="product-grid">
            {recs.map((r) => (
              <ProductCard
                key={r.id}
                product={r.product}
                token={accessToken}
                categoryName={r.product.category_id ? catName[r.product.category_id] : undefined}
                busy={addToCart.isPending}
                onAdd={() => addToCart.mutate(r.product.id)}
              />
            ))}
          </div>
        </section>
      )}

      {products.isLoading && <div className="state-box">Загрузка каталога…</div>}
      {products.isError && <div className="state-box error">Не удалось загрузить каталог</div>}
      {products.data && filtered.length === 0 && (
        <div className="state-box">Пока нет товаров по выбранным фильтрам.</div>
      )}
      <div className="product-grid">
        {filtered.map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            token={accessToken}
            categoryName={p.category_id ? catName[p.category_id] : undefined}
            busy={addToCart.isPending}
            onAdd={() => addToCart.mutate(p.id)}
          />
        ))}
      </div>
    </main>
  )
}

function ProductView({ id }: { id: string }) {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [variantId, setVariantId] = useState<string | null>(null)

  const product = useQuery({
    queryKey: ['shop-product', id],
    queryFn: () => apiRequest<ShopProduct>(`/v1/commerce/shop/products/${id}`, { token: accessToken }),
    enabled: Boolean(accessToken && id),
  })
  const categories = useQuery({
    queryKey: ['shop-categories'],
    queryFn: () => apiRequest<{ items: Category[] }>('/v1/commerce/product-categories', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const supplier = useQuery({
    queryKey: ['shop-supplier', product.data?.organization_id],
    queryFn: () => apiRequest<SupplierCard>(`/v1/suppliers/${product.data!.organization_id}`, { token: accessToken }),
    enabled: Boolean(accessToken && product.data?.organization_id),
  })
  const knowledge = useQuery({
    queryKey: ['shop-knowledge', id],
    queryFn: () =>
      apiRequest<{ items: KnowledgeCard[] }>(`/v1/knowledge?product_id=${id}&limit=6`, { token: accessToken }),
    enabled: Boolean(accessToken && id),
  })
  const pickup = useQuery({
    queryKey: ['shop-pickup'],
    queryFn: () => fetchPickupBranches(accessToken),
    enabled: Boolean(accessToken),
  })

  const addToCart = useMutation({
    mutationFn: (product_id: string) =>
      apiRequest<Cart>('/v1/commerce/shop/cart/items', {
        method: 'PUT',
        token: accessToken,
        body: { product_id, qty: 1 },
      }),
    onSuccess: async () => {
      setOk('Добавлено в корзину')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['shop-cart'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось добавить'),
  })

  const p = product.data
  const variants = p?.variants?.length ? p.variants : p ? [p] : []
  const selected = variants.find((v) => v.id === (variantId || p?.id)) ?? p
  const catName = categories.data?.items.find((c) => c.id === p?.category_id)?.name
  const recommended = pickup.data?.[0]
  const gallery = [selected?.photo_media_id, p?.photo_media_id, ...variants.map((v) => v.photo_media_id)]
    .filter((x, i, arr): x is string => Boolean(x) && arr.indexOf(x) === i)

  if (product.isLoading) return <main className="page"><div className="state-box">Загрузка товара…</div></main>
  if (!p || !selected) {
    return (
      <main className="page stack">
        <ShopChrome title="Магазин" />
        <div className="state-box error">Товар не найден</div>
      </main>
    )
  }

  return (
    <main className="page stack shop-page">
      <ShopChrome title={p.name} />
      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}
      <section className="shop-detail">
        <div className="shop-gallery">
          {gallery.length > 0 ? gallery.map((mediaId) => (
            <MediaImage key={mediaId} mediaId={mediaId} token={accessToken} alt={p.name} className="shop-gallery-img" />
          )) : (
            <div className="product-photo placeholder shop-gallery-img">{p.brand || 'Salon-X'}</div>
          )}
        </div>
        <div className="stack shop-detail-info">
          <p className="muted">{[p.brand, catName].filter(Boolean).join(' · ')}</p>
          <h2>{p.name}</h2>
          <strong className="shop-price-lg">{formatMoney(selected.price_minor)}</strong>
          <span className={`badge ${selected.available > 0 ? 'badge-confirmed' : 'badge-default'}`}>
            {selected.available > 0 ? `В наличии · ${selected.available} ${selected.unit}` : 'Нет в наличии'}
          </span>
          {p.description && <p>{p.description}</p>}
          {supplier.data && (
            <p className="muted">Поставщик: {supplier.data.name}{supplier.data.city ? ` · ${supplier.data.city}` : ''}</p>
          )}
          {variants.length > 1 && (
            <div className="chip-row">
              {variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={`chip ${selected.id === v.id ? 'active' : ''}`}
                  onClick={() => setVariantId(v.id)}
                >
                  {v.volume_label || v.unit} · {formatMoney(v.price_minor)}
                </button>
              ))}
            </div>
          )}
          <button
            className="btn btn-primary"
            type="button"
            disabled={selected.available <= 0 || addToCart.isPending}
            onClick={() => addToCart.mutate(selected.id)}
          >
            Добавить в корзину
          </button>
          {ok && (
            <button className="btn btn-secondary" type="button" onClick={() => navigate('/shop/cart')}>
              Перейти в корзину
            </button>
          )}
          <section className="card stack-sm">
            <strong>Самовывоз</strong>
            {recommended ? (
              <>
                <p className="muted">Рекомендуемый пункт: {branchLabel(recommended)}</p>
                <p className="muted">Можно изменить при оформлении заказа.</p>
              </>
            ) : (
              <p className="muted">Пункт самовывоза выбирается на шаге оформления.</p>
            )}
          </section>
        </div>
      </section>

      {(knowledge.data?.items?.length ?? 0) > 0 && (
        <section className="stack-sm">
          <h2>Материалы и инструкции</h2>
          <div className="kb-grid">
            {knowledge.data!.items.map((a) => (
              <Link key={a.id} className="kb-card" to={`/knowledge/${a.id}`}>
                {a.cover_media_id ? (
                  <MediaImage mediaId={a.cover_media_id} token={accessToken} alt={a.title} className="kb-cover" />
                ) : (
                  <div className="kb-cover" />
                )}
                <strong>{a.title}</strong>
                <p className="muted">{[a.category, a.reading_time_minutes ? `${a.reading_time_minutes} мин` : ''].filter(Boolean).join(' · ')}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}

function CartView() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  const cart = useQuery({
    queryKey: ['shop-cart'],
    queryFn: () => apiRequest<Cart>('/v1/commerce/shop/cart', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const setQty = useMutation({
    mutationFn: (input: { product_id: string; qty: number }) =>
      apiRequest<Cart>('/v1/commerce/shop/cart/items', {
        method: 'PUT',
        token: accessToken,
        body: input,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['shop-cart'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Ошибка корзины'),
  })

  const items = cart.data?.items ?? []
  const subtotal = cart.data?.total_minor ?? 0

  return (
    <main className="page stack shop-page">
      <ShopChrome title="Корзина" />
      {error && <div className="state-box error">{error}</div>}
      {cart.isLoading && <div className="state-box">Загрузка корзины…</div>}
      {!cart.isLoading && items.length === 0 && (
        <div className="state-box">
          Корзина пуста. <Link className="btn btn-secondary btn-compact" to="/shop">В каталог</Link>
        </div>
      )}
      {cart.data?.multi_supplier && (
        <div className="state-box">
          Товары разных поставщиков будут оформлены отдельными заказами в одном checkout.
        </div>
      )}
      <div className="stack">
        {items.map((it) => (
          <article key={it.product_id} className="card shop-line">
            <div>
              <strong>{it.brand} {it.name}</strong>
              <p className="muted">
                {formatMoney(it.price_minor)} · доступно {it.available}
                {it.price_changed && it.current_price_minor != null && (
                  <span className="badge badge-pending"> сейчас {formatMoney(it.current_price_minor)}</span>
                )}
              </p>
            </div>
            <label className="field shop-qty">
              <span>Кол-во</span>
              <input
                type="number"
                min={0}
                step={1}
                defaultValue={it.qty}
                onBlur={(e) => {
                  const qty = Number(e.target.value)
                  if (!Number.isFinite(qty) || qty === it.qty) return
                  setQty.mutate({ product_id: it.product_id, qty })
                }}
              />
            </label>
            <strong>{formatMoney(it.line_total_minor)}</strong>
            <button className="btn btn-secondary btn-compact" type="button" onClick={() => setQty.mutate({ product_id: it.product_id, qty: 0 })}>
              Удалить
            </button>
          </article>
        ))}
      </div>
      {items.length > 0 && (
        <section className="card stack">
          <div className="row between"><span>Подытог</span><strong>{formatMoney(subtotal)}</strong></div>
          <div className="row between"><span>Итого</span><strong>{formatMoney(subtotal)}</strong></div>
          <button
            className="btn btn-primary btn-block"
            type="button"
            onClick={() => navigate('/shop/checkout')}
          >
            Оформить заказ
          </button>
        </section>
      )}
    </main>
  )
}

function CheckoutView() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [pickupId, setPickupId] = useState('')
  const [address, setAddress] = useState('')
  const [comment, setComment] = useState('')
  const [payment, setPayment] = useState('cash')
  const [changeOpen, setChangeOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [priceWarning, setPriceWarning] = useState<string | null>(null)
  const [confirmPrices, setConfirmPrices] = useState(false)
  const idempotencyKey = useRef(typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()))

  const cart = useQuery({
    queryKey: ['shop-cart'],
    queryFn: () => apiRequest<Cart>('/v1/commerce/shop/cart', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const [pickup, setPickup] = useState<BranchCard[]>([])
  const [pickupLoading, setPickupLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function loadPickup() {
      const coords = await new Promise<{ lat: number; lng: number } | null>((resolve) => {
        if (!navigator.geolocation) return resolve(null)
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
          () => resolve(null),
          { timeout: 4000 },
        )
      })
      const items = await fetchPickupBranches(accessToken, undefined, [], coords)
      if (cancelled) return
      setPickup(items)
      if (items[0] && !pickupId) {
        setPickupId(items[0].id)
        setAddress(branchAddress(items[0]))
      }
      setPickupLoading(false)
    }
    if (accessToken) void loadPickup()
    return () => { cancelled = true }
  }, [accessToken])

  const selected = pickup.find((b) => b.id === pickupId) ?? pickup[0]
  const recommended = pickup[0]
  const mapPoints = pickup.filter((b) => typeof b.latitude === 'number' && typeof b.longitude === 'number')
  const mapCenter: [number, number] = selected?.latitude && selected?.longitude
    ? [selected.latitude, selected.longitude]
    : mapPoints[0]
      ? [mapPoints[0].latitude as number, mapPoints[0].longitude as number]
      : [55.75, 37.62]

  const checkout = useMutation({
    mutationFn: () =>
      apiRequest<CheckoutResult>('/v1/commerce/shop/checkout', {
        token: accessToken,
        idempotencyKey: idempotencyKey.current,
        body: {
          delivery_address: address.trim(),
          delivery_comment: comment.trim(),
          payment_method: payment,
          pickup_branch_id: pickupId || undefined,
          confirm_price_changes: confirmPrices,
        },
      }),
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: ['shop-cart'] })
      await qc.invalidateQueries({ queryKey: ['shop-orders'] })
      navigate('/shop/checkout/success', { state: { checkout: result } })
    },
    onError: async (e) => {
      if (e instanceof ApiError && e.status === 409 && e.message.toLowerCase().includes('цена')) {
        setPriceWarning(e.message)
        setConfirmPrices(true)
        await qc.invalidateQueries({ queryKey: ['shop-cart'] })
        setStep(3)
        return
      }
      setError(e instanceof ApiError ? e.message : 'Ошибка оформления')
    },
  })

  const items = cart.data?.items ?? []
  const supplierGroups = useMemo(() => {
    const groups = new Map<string, CartItem[]>()
    for (const it of items) {
      const key = it.organization_id ?? 'supplier'
      const list = groups.get(key) ?? []
      list.push(it)
      groups.set(key, list)
    }
    return [...groups.entries()]
  }, [items])
  if (!cart.isLoading && items.length === 0) {
    return (
      <main className="page stack">
        <ShopChrome title="Оформление" />
        <div className="state-box">Корзина пуста. <Link className="btn btn-secondary btn-compact" to="/shop">В каталог</Link></div>
      </main>
    )
  }

  const steps = [
    [1, 'Самовывоз'],
    [2, 'Оплата'],
    [3, 'Сводка'],
    [4, 'Подтверждение'],
  ] as const

  return (
    <main className="page stack shop-page">
      <ShopChrome title="Оформление заказа" />
      <div className="checkout-steps">
        {steps.map(([n, label]) => (
          <button key={n} type="button" className={`chip ${step === n ? 'active' : ''}`} onClick={() => n < step && setStep(n)}>
            {n}. {label}
          </button>
        ))}
      </div>
      {error && <div className="state-box error">{error}</div>}
      {priceWarning && (
        <div className="state-box">
          <p>Цена одного или нескольких товаров изменилась. Проверьте сводку и подтвердите новую цену или вернитесь в корзину.</p>
          <div className="row">
            <Link className="btn btn-secondary btn-compact" to="/shop/cart">Вернуться в корзину</Link>
            <button className="btn btn-primary btn-compact" type="button" onClick={() => { setConfirmPrices(true); setStep(4) }}>
              Подтвердить новую цену
            </button>
          </div>
        </div>
      )}

      {step === 1 && (
        <section className="stack">
          {pickupLoading && <div className="state-box">Ищем ближайший салон…</div>}
          {selected && (
            <article className="card stack-sm pickup-recommended">
              <p className="eyebrow">Рекомендуемый пункт</p>
              <h2>{selected.name}</h2>
              <p>{[selected.city, selected.address_line].filter(Boolean).join(', ')}</p>
              {typeof selected.distance_km === 'number' && (
                <p className="muted">{selected.distance_km.toFixed(1)} км от вас</p>
              )}
              {recommended && selected.id === recommended.id && (
                <span className="badge badge-confirmed">Ближайший салон</span>
              )}
              <button className="btn btn-secondary" type="button" onClick={() => setChangeOpen((v) => !v)}>
                Изменить
              </button>
            </article>
          )}
          {changeOpen && (
            <section className="stack">
              <div className="pickup-map">
                <MapContainer center={mapCenter} zoom={12} style={{ height: 240, width: '100%' }} scrollWheelZoom={false}>
                  <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  {mapPoints.map((b) => (
                    <CircleMarker
                      key={b.id}
                      center={[b.latitude as number, b.longitude as number]}
                      radius={b.id === pickupId ? 12 : 8}
                      pathOptions={{ color: b.id === pickupId ? CHART.accent : CHART.muted }}
                      eventHandlers={{
                        click: () => {
                          setPickupId(b.id)
                          setAddress(branchAddress(b))
                        },
                      }}
                    />
                  ))}
                </MapContainer>
              </div>
              <div className="list">
                {pickup.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className={`list-item pickup-option ${b.id === pickupId ? 'active' : ''}`}
                    onClick={() => {
                      setPickupId(b.id)
                      setAddress(branchAddress(b))
                    }}
                  >
                    <strong>{b.name}</strong>
                    <p className="muted">{branchLabel(b)}</p>
                    {b.id === recommended?.id && <span className="badge badge-confirmed">Рекомендуемый пункт</span>}
                  </button>
                ))}
              </div>
            </section>
          )}
          <button className="btn btn-primary" type="button" disabled={!pickupId} onClick={() => setStep(2)}>
            Далее · оплата
          </button>
        </section>
      )}

      {step === 2 && (
        <section className="card stack">
          <h2>Оплата</h2>
          {PAYMENTS.map((p) => (
            <label key={p.value} className="row">
              <input type="radio" name="pay" checked={payment === p.value} onChange={() => setPayment(p.value)} />
              {p.label}
            </label>
          ))}
          <div className="field">
            <label>Комментарий к получению</label>
            <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Код домофона, удобное время" />
          </div>
          <div className="row">
            <button className="btn btn-secondary" type="button" onClick={() => setStep(1)}>Назад</button>
            <button className="btn btn-primary" type="button" onClick={() => setStep(3)}>Далее · сводка</button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="card stack">
          <h2>Сводка</h2>
          {supplierGroups.map(([key, groupItems], idx) => (
            <div key={key} className="stack-sm checkout-supplier-group">
              <p className="eyebrow">Поставщик {supplierGroups.length > 1 ? idx + 1 : ''}</p>
              {groupItems.map((it) => (
                <div key={it.product_id} className="stack-sm">
                  <div className="row between">
                    <span>{it.brand} {it.name} × {it.qty}</span>
                    <span>{formatMoney(it.price_changed && it.current_price_minor != null ? Math.round(it.qty * it.current_price_minor) : it.line_total_minor)}</span>
                  </div>
                  {it.price_changed && it.current_price_minor != null && (
                    <p className="muted">Цена изменилась: {formatMoney(it.price_minor)} → {formatMoney(it.current_price_minor)}</p>
                  )}
                </div>
              ))}
            </div>
          ))}
          <div className="row between"><strong>Итого</strong><strong>{formatMoney(cart.data?.total_minor ?? 0)}</strong></div>
          {supplierGroups.length > 1 && (
            <p className="muted">Будет создано заказов: {supplierGroups.length}</p>
          )}
          <p><strong>Самовывоз:</strong> {selected ? branchLabel(selected) : address}</p>
          <p><strong>Оплата:</strong> {paymentLabel(payment)}</p>
          <div className="row">
            <button className="btn btn-secondary" type="button" onClick={() => setStep(2)}>Назад</button>
            <button className="btn btn-primary" type="button" onClick={() => setStep(4)}>Подтвердить</button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="card stack">
          <h2>Подтверждение</h2>
          <p>Заказ будет ожидать самовывоза в салоне. Оплата — при получении.</p>
          <p className="muted">{selected ? branchLabel(selected) : address}</p>
          <button
            className="btn btn-primary btn-block"
            type="button"
            disabled={checkout.isPending || address.trim().length < 5}
            onClick={() => checkout.mutate()}
          >
            Подтвердить заказ
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => setStep(3)}>Назад</button>
        </section>
      )}
    </main>
  )
}

function OrdersView() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const orders = useQuery({
    queryKey: ['shop-orders'],
    queryFn: () => apiRequest<{ items: ClientOrder[] }>('/v1/commerce/shop/orders', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const pickup = useQuery({
    queryKey: ['shop-pickup'],
    queryFn: () => fetchPickupBranches(accessToken),
    enabled: Boolean(accessToken),
  })
  const reorder = useMutation({
    mutationFn: (id: string) =>
      apiRequest<{ cart: Cart; skipped: Array<{ product_id: string; reason: string }> }>(
        `/v1/commerce/shop/orders/${id}/reorder`,
        { token: accessToken },
      ),
    onSuccess: async (res) => {
      const skipped = res.skipped?.length ? ` Пропущено: ${res.skipped.length}` : ''
      setOk(`Корзина заполнена актуальными ценами.${skipped}`)
      await qc.invalidateQueries({ queryKey: ['shop-cart'] })
      navigate('/shop/cart')
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось повторить'),
  })

  const salonName = (id?: string | null) => pickup.data?.find((b) => b.id === id)?.name

  return (
    <main className="page stack shop-page">
      <ShopChrome title="Мои заказы" />
      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}
      {orders.isLoading && <div className="state-box">Загрузка заказов…</div>}
      {orders.data && orders.data.items.length === 0 && <div className="state-box">Заказов ещё нет</div>}
      <div className="stack">
        {orders.data?.items.map((o) => (
          <article key={o.id} className="card shop-order">
            <div className="row between">
              <strong>{o.order_number ?? formatMoney(o.total_minor)}</strong>
              <span className={`badge ${statusBadgeClass(o.status)}`}>{clientOrderLabel(o.status)}</span>
            </div>
            <p className="muted">{new Date(o.created_at).toLocaleString('ru-RU')} · {formatMoney(o.total_minor)}</p>
            <p>{(o.items ?? []).map((it) => `${it.brand} ${it.product_name} × ${it.qty}`).join(', ') || 'Состав заказа'}</p>
            <p className="muted">Салон: {salonName(o.pickup_branch_id) || o.delivery_address || '—'}</p>
            <p className="muted">Оплата: {shopPaymentStatus(o)} · {paymentLabel(o.payment_method)}</p>
            <div className="row">
              <Link className="btn btn-secondary btn-compact" to={`/orders/${o.id}`}>Подробнее</Link>
              <button className="btn btn-secondary btn-compact" type="button" disabled={reorder.isPending} onClick={() => reorder.mutate(o.id)}>
                Повторить заказ
              </button>
            </div>
          </article>
        ))}
      </div>
    </main>
  )
}

function CheckoutSuccessView() {
  const loc = useLocation()
  const navigate = useNavigate()
  const state = loc.state as { checkout?: CheckoutResult; order?: ClientOrder } | null
  const orders = state?.checkout?.orders ?? (state?.order ? [state.order] : [])
  const total = state?.checkout?.total_minor ?? orders.reduce((s, o) => s + o.total_minor, 0)
  const { accessToken } = useAuth()
  const pickup = useQuery({
    queryKey: ['shop-pickup'],
    queryFn: () => fetchPickupBranches(accessToken),
    enabled: Boolean(accessToken),
  })
  const salon = pickup.data?.find((b) => b.id === orders[0]?.pickup_branch_id)

  if (orders.length === 0) {
    return (
      <main className="page stack">
        <ShopChrome title="Заказ оформлен" />
        <div className="state-box">
          Заказ создан. <Link to="/orders">Мои заказы</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="page stack shop-page">
      <ShopChrome title="Магазин" />
      <section className="card stack success-panel">
        <p className="eyebrow">Готово</p>
        <h2>Заказ оформлен</h2>
        <p className="order-number">{orders.length === 1 ? (orders[0].order_number ?? 'Ваш заказ') : `${orders.length} заказа · ${formatMoney(total)}`}</p>
        {orders.map((o) => (
          <p key={o.id}>{o.order_number ?? formatMoney(o.total_minor)}</p>
        ))}
        <p><strong>Самовывоз:</strong> {salon ? branchLabel(salon) : orders[0].delivery_address}</p>
        <p><strong>Оплата:</strong> {paymentLabel(orders[0].payment_method)} · {shopPaymentStatus(orders[0])}</p>
        <p className="muted">Мы сообщим, когда заказ будет готов к выдаче в салоне.</p>
        <div className="row">
          {orders.length === 1 && <Link className="btn btn-primary" to={`/orders/${orders[0].id}`}>Детали заказа</Link>}
          <Link className="btn btn-secondary" to="/orders">Мои заказы</Link>
          <button className="btn btn-secondary" type="button" onClick={() => navigate('/shop')}>Продолжить покупки</button>
        </div>
      </section>
    </main>
  )
}

function OrderDetailView({ id }: { id: string }) {
  const { accessToken } = useAuth()
  const navigate = useNavigate()
  const order = useQuery({
    queryKey: ['shop-order', id],
    queryFn: () => apiRequest<ClientOrder>(`/v1/commerce/shop/orders/${id}`, { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const pickup = useQuery({
    queryKey: ['shop-pickup'],
    queryFn: () => fetchPickupBranches(accessToken),
    enabled: Boolean(accessToken),
  })
  const salon = pickup.data?.find((b) => b.id === order.data?.pickup_branch_id)
  const history = order.data?.status_history ?? []

  return (
    <main className="page stack shop-page">
      <ShopChrome title="Заказ" />
      {order.isLoading && <div className="state-box">Загрузка…</div>}
      {order.error && <div className="state-box error">Заказ не найден</div>}
      {order.data && (
        <>
          <section className="card stack">
            <div className="row between">
              <h1>{order.data.order_number ?? 'Заказ'}</h1>
              <span className={`badge ${statusBadgeClass(order.data.status)}`}>{clientOrderLabel(order.data.status)}</span>
            </div>
            <p className="muted">{new Date(order.data.created_at).toLocaleString('ru-RU')}</p>
            <p><strong>Салон:</strong> {salon ? branchLabel(salon) : order.data.delivery_address}</p>
            <p><strong>Оплата:</strong> {paymentLabel(order.data.payment_method)} · {shopPaymentStatus(order.data)}</p>
            <p><strong>Итого:</strong> {formatMoney(order.data.total_minor)}</p>
          </section>
          <section className="card stack">
            <h2>Товары</h2>
            {(order.data.items ?? []).map((it, i) => (
              <div key={i} className="row between">
                <span>{it.brand} {it.product_name} × {it.qty}</span>
                <span>{formatMoney(Math.round(it.price_minor * it.qty))}</span>
              </div>
            ))}
          </section>
          {history.length > 0 && (
            <section className="card stack order-timeline">
              <h2>Статус заказа</h2>
              <ol className="timeline">
                {history.map((h, i) => (
                  <li key={i} className={`timeline-item ${i === history.length - 1 ? 'active' : ''}`}>
                    <strong>{clientOrderLabel(h.to_status || h.from_status)}</strong>
                    <span className="muted">{new Date(h.created_at).toLocaleString('ru-RU')}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <button className="btn btn-secondary" type="button" onClick={() => navigate('/orders')}>← Мои заказы</button>
        </>
      )}
    </main>
  )
}
