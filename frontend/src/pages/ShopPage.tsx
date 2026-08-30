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
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Drawer } from '@/shared/ui/Drawer'
import { CHART } from '@/shared/ui/chart-theme'
import { productAudienceLabel } from '@/pages/knowledge-helpers'
import {
  cartLineInsufficient,
  nextCartQty,
  shopHasActiveFilters,
  shopLineTotal,
  shopOrderIsTerminal,
  shopStockLabel,
  shopStockTone,
} from '@/pages/shop-helpers'
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
  photo_media_id?: string | null
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

function useCompactShop() {
  const [compact, setCompact] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : true,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const onChange = () => setCompact(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    window.addEventListener('resize', onChange)
    return () => {
      mq.removeEventListener('change', onChange)
      window.removeEventListener('resize', onChange)
    }
  }, [])
  return compact
}

function stockBadgeClass(available: number) {
  const tone = shopStockTone(available)
  if (tone === 'ok') return 'badge-confirmed'
  if (tone === 'low') return 'badge-pending'
  return 'badge-cancelled'
}

function ProductMedia({
  mediaId,
  token,
  alt,
  className,
  frame = 'media-frame media-frame--product',
}: {
  mediaId?: string | null
  token?: string | null
  alt: string
  className?: string
  frame?: string
}) {
  return (
    <div className={`${frame} ${className ?? ''}`.trim()}>
      <MediaImage mediaId={mediaId} token={token} alt={alt} fallback={alt.slice(0, 2).toUpperCase()} />
    </div>
  )
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
  const professional = product.audience === 'professional_only'
  return (
    <article className="product-card shop-product-card">
      <Link to={`/shop/${product.id}`} className="shop-product-media">
        <ProductMedia mediaId={product.photo_media_id} token={token} alt={product.name} />
      </Link>
      <p className="muted shop-product-meta">
        {[product.brand, categoryName, product.volume_label || product.unit].filter(Boolean).join(' · ')}
      </p>
      <Link to={`/shop/${product.id}`} className="shop-product-title"><strong>{product.name}</strong></Link>
      {professional ? <span className="badge badge-default">{productAudienceLabel(product.audience)}</span> : null}
      <div className="row between wrap shop-product-price-row">
        <span className="shop-price">{formatMoney(product.price_minor)}</span>
        <span className={`badge ${stockBadgeClass(product.available)}`}>
          {shopStockLabel(product.available)}
        </span>
      </div>
      <div className="row shop-product-actions">
        <Link className="btn btn-secondary" to={`/shop/${product.id}`}>Подробнее</Link>
        <button
          className="btn btn-primary"
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
  const compact = useCompactShop()
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [brand, setBrand] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [sort, setSort] = useState<SortKey>('default')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [error, setError] = useState<unknown>(null)
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
    onError: (e) => setError(e),
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
  const activeFilters = shopHasActiveFilters(brand, categoryId, search)

  const filterFields = (
    <>
      <label className="field">
        <span>Бренд</span>
        <select value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Бренд">
          <option value="">Все бренды</option>
          {brands.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Категория</span>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Категория">
          <option value="">Все категории</option>
          {usedCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Сортировка</span>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Сортировка">
          <option value="default">По умолчанию</option>
          <option value="price_asc">Цена ↑</option>
          <option value="price_desc">Цена ↓</option>
          <option value="name">Название</option>
        </select>
      </label>
    </>
  )

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
        {compact ? (
          <button className="btn btn-secondary" type="button" onClick={() => setFiltersOpen(true)}>
            Фильтры{activeFilters ? ' · выбраны' : ''}
          </button>
        ) : null}
      </form>

      {compact ? (
        <Drawer
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          title="Фильтры"
          label="Фильтры магазина"
        >
          <div className="shop-filters shop-filters--drawer">{filterFields}</div>
          <div className="row wrap">
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => {
                setBrand('')
                setCategoryId('')
                setSort('default')
                setQ('')
                setSearch('')
              }}
            >
              Сбросить
            </button>
            <button className="btn btn-primary" type="button" onClick={() => setFiltersOpen(false)}>
              Применить
            </button>
          </div>
        </Drawer>
      ) : (
        <div className="shop-filters">{filterFields}</div>
      )}
      <div className="chip-row" role="toolbar" aria-label="Категории">
        <button type="button" className={`chip ${!categoryId ? 'active' : ''}`} aria-pressed={!categoryId} onClick={() => setCategoryId('')}>Все</button>
        {usedCategories.map((c) => (
          <button key={c.id} type="button" className={`chip ${categoryId === c.id ? 'active' : ''}`} aria-pressed={categoryId === c.id} onClick={() => setCategoryId(c.id)}>
            {c.name}
          </button>
        ))}
      </div>

      <ErrorBanner error={error} fallbackTitle="Не удалось добавить товар" />
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

      {products.isLoading && (
        <div className="product-grid" aria-busy="true" aria-label="Загрузка каталога">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="product-card shop-product-card">
              <div className="media-frame media-frame--product"><div className="media-skeleton" /></div>
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line" />
            </div>
          ))}
        </div>
      )}
      {products.isError && <ErrorBanner error={products.error} fallbackTitle="Не удалось загрузить каталог" />}
      {products.data && filtered.length === 0 && (
        <EmptyState
          title={activeFilters ? 'Нет товаров по фильтрам' : 'В магазине пока нет товаров'}
          text={activeFilters ? 'Сбросьте фильтры или измените запрос — в каталоге появятся подходящие позиции.' : 'Как только появятся опубликованные товары, они отобразятся здесь.'}
          action={
            activeFilters ? (
              <button className="btn btn-secondary" type="button" onClick={() => { setBrand(''); setCategoryId(''); setSort('default'); setQ(''); setSearch('') }}>
                Сбросить фильтры
              </button>
            ) : undefined
          }
        />
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
  const [error, setError] = useState<unknown>(null)
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
    onError: (e) => setError(e),
  })

  const p = product.data
  const variants = p?.variants?.length ? p.variants : p ? [p] : []
  const selected = variants.find((v) => v.id === (variantId || p?.id)) ?? p
  const catName = categories.data?.items.find((c) => c.id === p?.category_id)?.name
  const recommended = pickup.data?.[0]
  const gallery = [selected?.photo_media_id, p?.photo_media_id, ...variants.map((v) => v.photo_media_id)]
    .filter((x, i, arr): x is string => Boolean(x) && arr.indexOf(x) === i)

  if (product.isLoading) {
    return (
      <main className="page stack shop-page">
        <ShopChrome title="Магазин" />
        <section className="shop-detail" aria-busy="true">
          <div className="media-frame media-frame--product"><div className="media-skeleton" /></div>
          <div className="stack">
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-card" />
          </div>
        </section>
      </main>
    )
  }
  if (product.isError || !p || !selected) {
    return (
      <main className="page stack">
        <ShopChrome title="Магазин" />
        <ErrorBanner error={product.error} fallbackTitle="Товар не найден" />
        <EmptyState
          title="Товар недоступен"
          text="Этой позиции нет в каталоге или она предназначена только для салонов."
          action={<Link className="btn btn-secondary" to="/shop">В каталог</Link>}
        />
      </main>
    )
  }

  return (
    <main className="page stack shop-page">
      <ShopChrome title={p.name} />
      <ErrorBanner error={error} fallbackTitle="Не удалось добавить товар" />
      {ok && <div className="state-box success">{ok}</div>}
      <section className="shop-detail">
        <div className="shop-gallery">
          {gallery.length > 0 ? gallery.map((mediaId) => (
            <ProductMedia key={mediaId} mediaId={mediaId} token={accessToken} alt={p.name} className="shop-gallery-img" />
          )) : (
            <ProductMedia alt={p.brand || p.name} className="shop-gallery-img" />
          )}
        </div>
        <div className="stack shop-detail-info">
          <p className="muted">{[p.brand, catName].filter(Boolean).join(' · ')}</p>
          <h2>{p.name}</h2>
          <span className="badge badge-default">{productAudienceLabel(p.audience)}</span>
          <strong className="shop-price-lg">{formatMoney(selected.price_minor)}</strong>
          <span className={`badge ${stockBadgeClass(selected.available)}`}>
            {shopStockLabel(selected.available, selected.unit)}
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
            className="btn btn-primary btn-block shop-detail-cta"
            type="button"
            disabled={selected.available <= 0 || addToCart.isPending}
            onClick={() => addToCart.mutate(selected.id)}
          >
            Добавить в корзину
          </button>
          {ok && (
            <button className="btn btn-secondary btn-block" type="button" onClick={() => navigate('/shop/cart')}>
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
                <MediaImage
                  mediaId={a.cover_media_id}
                  token={accessToken}
                  alt={a.title}
                  className="kb-cover"
                  fallback={a.title.slice(0, 2).toUpperCase()}
                />
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

function QtyStepper({
  qty,
  available,
  name,
  disabled,
  onChange,
}: {
  qty: number
  available: number
  name: string
  disabled?: boolean
  onChange: (qty: number) => void
}) {
  return (
    <div className="shop-qty-stepper" role="group" aria-label={`Количество: ${name}`}>
      <button
        type="button"
        className="btn btn-secondary shop-qty-btn"
        aria-label="Уменьшить количество"
        disabled={disabled || qty <= 0}
        onClick={() => onChange(nextCartQty(qty, -1, available))}
      >
        −
      </button>
      <span className="shop-qty-value" aria-live="polite">{qty}</span>
      <button
        type="button"
        className="btn btn-secondary shop-qty-btn"
        aria-label="Увеличить количество"
        disabled={disabled || qty >= available}
        onClick={() => onChange(nextCartQty(qty, 1, available))}
      >
        +
      </button>
    </div>
  )
}

function CartView() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [error, setError] = useState<unknown>(null)

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
      setError(null)
      await qc.invalidateQueries({ queryKey: ['shop-cart'] })
    },
    onError: (e) => setError(e),
  })

  const items = cart.data?.items ?? []
  const subtotal = cart.data?.total_minor ?? 0
  const stockIssue = items.some((it) => cartLineInsufficient(it.qty, it.available) || it.available <= 0)
  const priceIssue = items.some((it) => it.price_changed)

  return (
    <main className="page stack shop-page">
      <ShopChrome title="Корзина" />
      <ErrorBanner error={error} fallbackTitle="Не удалось изменить корзину" />
      {cart.isError && <ErrorBanner error={cart.error} fallbackTitle="Не удалось загрузить корзину" />}
      {cart.isLoading && (
        <div className="stack" aria-busy="true">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      )}
      {!cart.isLoading && items.length === 0 && (
        <EmptyState
          title="В корзине пока ничего нет"
          text="Добавьте товары из каталога — самовывоз будет в салоне."
          action={<Link className="btn btn-primary" to="/shop">Перейти в магазин</Link>}
        />
      )}
      {cart.data?.multi_supplier && items.length > 0 && (
        <p className="muted">Товары разных поставщиков будут оформлены отдельными заказами в одном checkout.</p>
      )}
      {priceIssue && (
        <ErrorBanner
          error={{ code: 'price_changed', status: 409, message: 'цена изменилась' }}
        />
      )}
      {stockIssue && (
        <ErrorBanner
          error={{ code: 'insufficient_stock', status: 409, message: 'недостаточно' }}
        />
      )}
      <div className="stack">
        {items.map((it) => {
          const unitPrice = it.price_changed && it.current_price_minor != null ? it.current_price_minor : it.price_minor
          return (
            <article key={it.product_id} className="card shop-line">
              <ProductMedia mediaId={it.photo_media_id} token={accessToken} alt={it.name} frame="media-frame media-frame--thumb" />
              <div className="shop-line-copy">
                <strong>{it.brand} {it.name}</strong>
                <p className="muted">
                  {formatMoney(unitPrice)} · {shopStockLabel(it.available, it.unit)}
                </p>
                {it.price_changed && it.current_price_minor != null && (
                  <p className="muted">Цена изменилась: {formatMoney(it.price_minor)} → {formatMoney(it.current_price_minor)}</p>
                )}
                {cartLineInsufficient(it.qty, it.available) && (
                  <p className="muted">Товара недостаточно на складе. Уменьшите количество.</p>
                )}
              </div>
              <QtyStepper
                qty={it.qty}
                available={it.available}
                name={`${it.brand} ${it.name}`}
                disabled={setQty.isPending}
                onChange={(qty) => setQty.mutate({ product_id: it.product_id, qty })}
              />
              <strong className="shop-line-total">{formatMoney(shopLineTotal(it.qty, unitPrice))}</strong>
              <button className="btn btn-secondary" type="button" onClick={() => setQty.mutate({ product_id: it.product_id, qty: 0 })}>
                Удалить
              </button>
            </article>
          )
        })}
      </div>
      {items.length > 0 && (
        <section className="card stack shop-cart-summary">
          <div className="row between"><span>Подытог</span><strong>{formatMoney(subtotal)}</strong></div>
          <div className="row between"><span>Итого</span><strong>{formatMoney(subtotal)}</strong></div>
          <button
            className="btn btn-primary btn-block"
            type="button"
            disabled={stockIssue}
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
  const compact = useCompactShop()
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [pickupId, setPickupId] = useState('')
  const [address, setAddress] = useState('')
  const [comment, setComment] = useState('')
  const [payment, setPayment] = useState('cash')
  const [changeOpen, setChangeOpen] = useState(false)
  const [error, setError] = useState<unknown>(null)
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
      setError(e)
      if (e instanceof ApiError && e.code === 'price_changed') {
        setConfirmPrices(true)
        await qc.invalidateQueries({ queryKey: ['shop-cart'] })
        setStep(3)
      }
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
  const priceChanged = error instanceof ApiError && error.code === 'price_changed'
  const pickupPicker = (
    <section className="stack shop-pickup-picker">
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
            aria-pressed={b.id === pickupId}
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
  )

  if (!cart.isLoading && items.length === 0) {
    return (
      <main className="page stack shop-page">
        <ShopChrome title="Оформление заказа" />
        <EmptyState
          title="В корзине пока ничего нет"
          text="Добавьте товары из каталога, чтобы оформить заказ."
          action={<Link className="btn btn-primary" to="/shop">Перейти в магазин</Link>}
        />
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
      <ErrorBanner error={error} fallbackTitle="Не удалось оформить заказ" />
      {priceChanged && (
        <div className="row wrap">
          <Link className="btn btn-secondary" to="/shop/cart">Вернуться в корзину</Link>
          <button className="btn btn-primary" type="button" onClick={() => { setConfirmPrices(true); setStep(4) }}>
            Подтвердить новую цену
          </button>
        </div>
      )}

      <div className="checkout-layout">
        <div className="checkout-flow stack">
          {step === 1 && (
            <section className="stack">
              {pickupLoading && <div className="skeleton skeleton-card" aria-busy="true" aria-label="Ищем ближайший салон" />}
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
                  <button className="btn btn-secondary" type="button" onClick={() => setChangeOpen(true)}>
                    Изменить
                  </button>
                </article>
              )}
              {compact ? (
                <Drawer
                  open={changeOpen}
                  onClose={() => setChangeOpen(false)}
                  title="Пункт самовывоза"
                  label="Выбор салона"
                >
                  {pickupPicker}
                  <button className="btn btn-primary btn-block" type="button" onClick={() => setChangeOpen(false)}>
                    Готово
                  </button>
                </Drawer>
              ) : changeOpen ? pickupPicker : null}
              <button className="btn btn-primary btn-block" type="button" disabled={!pickupId} onClick={() => setStep(2)}>
                Далее · оплата
              </button>
            </section>
          )}

          {step === 2 && (
            <section className="card stack">
              <h2>Оплата</h2>
              {PAYMENTS.map((p) => (
                <label key={p.value} className="field-check">
                  <input type="radio" name="pay" checked={payment === p.value} onChange={() => setPayment(p.value)} />
                  {p.label}
                </label>
              ))}
              <div className="field">
                <label>Комментарий к получению</label>
                <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Код домофона, удобное время" />
              </div>
              <div className="row wrap">
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
              <div className="row wrap">
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
              <button className="btn btn-secondary btn-block" type="button" onClick={() => setStep(3)}>Назад</button>
            </section>
          )}
        </div>

        <aside className="card stack shop-checkout-summary" aria-label="Сводка заказа">
          <p className="eyebrow">Заказ</p>
          {items.map((it) => (
            <div key={it.product_id} className="row between wrap">
              <span>{it.brand} {it.name} × {it.qty}</span>
              <strong>{formatMoney(it.price_changed && it.current_price_minor != null ? Math.round(it.qty * it.current_price_minor) : it.line_total_minor)}</strong>
            </div>
          ))}
          <div className="row between"><strong>Итого</strong><strong>{formatMoney(cart.data?.total_minor ?? 0)}</strong></div>
        </aside>
      </div>
    </main>
  )
}

function OrdersView() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [error, setError] = useState<unknown>(null)
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
      setError(null)
      await qc.invalidateQueries({ queryKey: ['shop-cart'] })
      navigate('/shop/cart')
    },
    onError: (e) => setError(e),
  })

  const salonName = (id?: string | null) => pickup.data?.find((b) => b.id === id)?.name

  return (
    <main className="page stack shop-page">
      <ShopChrome title="Мои заказы" />
      <ErrorBanner error={error} fallbackTitle="Не удалось повторить заказ" />
      {orders.isError && <ErrorBanner error={orders.error} fallbackTitle="Не удалось загрузить заказы" />}
      {ok && <div className="state-box success">{ok}</div>}
      {orders.isLoading && (
        <div className="stack" aria-busy="true">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      )}
      {orders.data && orders.data.items.length === 0 && (
        <EmptyState
          title="Заказов ещё нет"
          text="Когда оформите покупку, заказ появится здесь со статусом и составом."
          action={<Link className="btn btn-primary" to="/shop">Перейти в магазин</Link>}
        />
      )}
      <div className="stack">
        {orders.data?.items.map((o) => (
          <article key={o.id} className={`card shop-order ${shopOrderIsTerminal(o.status) ? 'shop-order--terminal' : ''}`}>
            <div className="row between wrap">
              <strong>{o.order_number ?? formatMoney(o.total_minor)}</strong>
              <span className={`badge ${statusBadgeClass(o.status)}`}>{clientOrderLabel(o.status)}</span>
            </div>
            <p className="muted">{new Date(o.created_at).toLocaleString('ru-RU')} · {formatMoney(o.total_minor)}</p>
            <p>{(o.items ?? []).map((it) => `${it.brand} ${it.product_name} × ${it.qty}`).join(', ') || 'Состав заказа'}</p>
            <p className="muted">Салон: {salonName(o.pickup_branch_id) || o.delivery_address || '—'}</p>
            <p className="muted">Оплата: {shopPaymentStatus(o)} · {paymentLabel(o.payment_method)}</p>
            <div className="row wrap shop-order-actions">
              <Link className="btn btn-secondary" to={`/orders/${o.id}`}>Подробнее</Link>
              <button className="btn btn-secondary" type="button" disabled={reorder.isPending} onClick={() => reorder.mutate(o.id)}>
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
      <main className="page stack shop-page">
        <ShopChrome title="Заказ оформлен" />
        <EmptyState
          title="Заказ создан"
          text="Откройте список заказов, чтобы посмотреть номер, статус и состав."
          action={<Link className="btn btn-primary" to="/orders">Мои заказы</Link>}
        />
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
        <div className="row wrap">
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
  const terminal = order.data ? shopOrderIsTerminal(order.data.status) : false

  return (
    <main className="page stack shop-page">
      <ShopChrome title="Заказ" />
      {order.isLoading && <div className="skeleton skeleton-card" aria-busy="true" />}
      {order.error && (
        <>
          <ErrorBanner error={order.error} fallbackTitle="Заказ не найден" />
          <EmptyState
            title="Заказ не найден"
            text="Возможно, ссылка устарела или заказ принадлежит другому аккаунту."
            action={<Link className="btn btn-secondary" to="/orders">Мои заказы</Link>}
          />
        </>
      )}
      {order.data && (
        <>
          <section className={`card stack ${terminal ? 'shop-order--terminal' : ''}`}>
            <div className="row between wrap">
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
              <div key={i} className="row between wrap">
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
