import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/shared/lib/money'
import { clientOrderLabel, statusBadgeClass } from '@/shared/lib/status'
import { fetchPickupBranches, type BranchCard } from '@/shared/lib/commerce'
import { MediaImage } from '@/shared/ui/MediaImage'
import { Hint } from '@/shared/ui/Hint'

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
  audience?: string
  variants?: ShopProduct[]
}

type CartItem = {
  product_id: string
  qty: number
  brand: string
  name: string
  price_minor: number
  available: number
  line_total_minor: number
  unit: string
}

type Cart = {
  id: string
  items: CartItem[]
  total_minor: number
}

type ClientOrder = {
  id: string
  status: string
  total_minor: number
  delivery_address: string
  created_at: string
  items?: Array<{ product_name: string; brand: string; qty: number; price_minor: number }>
}

type Tab = 'catalog' | 'cart' | 'orders'

export function ShopPage() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('catalog')
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [address, setAddress] = useState('')
  const [comment, setComment] = useState('')
  const [payment, setPayment] = useState('cash_on_delivery')
  const [pickup, setPickup] = useState<BranchCard[]>([])
  const [pickupId, setPickupId] = useState('')

  const products = useQuery({
    queryKey: ['shop-products', search],
    queryFn: () =>
      apiRequest<{ items: ShopProduct[] }>(
        `/v1/commerce/shop/products?q=${encodeURIComponent(search)}&limit=50`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken),
  })

  const recommendations = useQuery({
    queryKey: ['shop-recommendations'],
    queryFn: () =>
      apiRequest<{
        items: Array<{
          id: string
          comment: string
          master_user_id: string
          product: ShopProduct
        }>
      }>('/v1/commerce/shop/recommendations', { token: accessToken }),
    enabled: Boolean(accessToken && tab === 'catalog'),
  })

  const cart = useQuery({
    queryKey: ['shop-cart'],
    queryFn: () => apiRequest<Cart>('/v1/commerce/shop/cart', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const orders = useQuery({
    queryKey: ['shop-orders'],
    queryFn: () => apiRequest<{ items: ClientOrder[] }>('/v1/commerce/shop/orders', { token: accessToken }),
    enabled: Boolean(accessToken && tab === 'orders'),
  })

  const product = useQuery({
    queryKey: ['shop-product', selectedId],
    queryFn: () => apiRequest<ShopProduct>(`/v1/commerce/shop/products/${selectedId}`, { token: accessToken }),
    enabled: Boolean(accessToken && selectedId),
  })

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
        setAddress([items[0].city, items[0].address_line, items[0].name].filter(Boolean).join(', '))
      }
    }
    if (accessToken) void loadPickup()
    return () => { cancelled = true }
  }, [accessToken])

  const addToCart = useMutation({
    mutationFn: (input: { product_id: string; qty: number }) =>
      apiRequest<Cart>('/v1/commerce/shop/cart/items', {
        method: 'PUT',
        token: accessToken,
        body: input,
      }),
    onSuccess: async () => {
      setOk('Товар в корзине')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['shop-cart'] })
      setTab('cart')
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось добавить'),
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

  const checkout = useMutation({
    mutationFn: () =>
      apiRequest<ClientOrder>('/v1/commerce/shop/checkout', {
        token: accessToken,
        body: {
          delivery_address: address.trim(),
          delivery_comment: comment.trim(),
          payment_method: payment,
          pickup_branch_id: pickupId || undefined,
        },
      }),
    onSuccess: async () => {
      setOk('Заказ оформлен')
      setError(null)
      setAddress('')
      setComment('')
      await qc.invalidateQueries({ queryKey: ['shop-cart'] })
      await qc.invalidateQueries({ queryKey: ['shop-orders'] })
      setTab('orders')
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Ошибка оформления'),
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
      setTab('cart')
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось повторить'),
  })

  return (
    <main className="page stack">
      <div className="row between">
        <div className="stack-sm">
          <h1>Магазин</h1>
          <p className="muted">
            Только товары для клиентов. Самовывоз в ближайшем салоне.
            <Hint id="shop-pickup" title="Самовывоз">По умолчанию выбран ближайший салон. Можно сменить вручную.</Hint>
          </p>
        </div>
        <span className="muted">Цены с сервера</span>
      </div>

      <div className="row">
        {([
          ['catalog', 'Каталог'],
          ['cart', `Корзина${cart.data?.items?.length ? ` (${cart.data.items.length})` : ''}`],
          ['orders', 'Заказы'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`btn ${tab === id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}

      {tab === 'catalog' && (
        <section className="stack">
          <section className="card stack">
            <h2>Рекомендации мастеров</h2>
            {recommendations.isLoading && <div className="state-box">Загрузка рекомендаций…</div>}
            {recommendations.isError && <div className="state-box error">Не удалось загрузить рекомендации</div>}
            {recommendations.data && recommendations.data.items.length === 0 && (
              <div className="state-box">Пока нет рекомендаций от ваших мастеров</div>
            )}
            <div className="list">
              {recommendations.data?.items.map((r) => (
                <article key={r.id} className="list-item">
                  <div className="row between">
                    <strong>{r.product.brand ? `${r.product.brand} · ` : ''}{r.product.name}</strong>
                    <span>{formatMoney(r.product.price_minor)}</span>
                  </div>
                  {r.comment && <p>{r.comment}</p>}
                  <p className="muted">
                    {r.product.available > 0 ? `В наличии ${r.product.available}` : 'Нет в наличии'}
                  </p>
                  <button
                    className="btn btn-primary btn-compact"
                    type="button"
                    disabled={r.product.available <= 0 || addToCart.isPending}
                    onClick={() => addToCart.mutate({ product_id: r.product.id, qty: 1 })}
                  >
                    В корзину
                  </button>
                </article>
              ))}
            </div>
          </section>

          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              setSearch(q.trim())
            }}
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск по названию или бренду"
              style={{ flex: 1, minWidth: 0 }}
            />
            <button className="btn btn-primary" type="submit">Найти</button>
          </form>

          {products.isLoading && <div className="state-box">Загрузка каталога…</div>}
          {products.isError && <div className="state-box error">Не удалось загрузить каталог</div>}
          {products.data && products.data.items.length === 0 && (
            <div className="state-box">
              Опубликованных товаров пока нет. Поставщик добавляет их на складе и публикует.
            </div>
          )}

          <div className="product-grid">
            {products.data?.items.map((p) => (
              <article key={p.id} className="product-card">
                {p.photo_media_id ? (
                  <MediaImage mediaId={p.photo_media_id} token={accessToken} alt={p.name} className="product-photo" />
                ) : (
                  <div className="product-photo placeholder">Salon-X</div>
                )}
                <strong>{p.name}</strong>
                <p className="muted">{[p.brand, p.volume_label || p.unit].filter(Boolean).join(' · ')}</p>
                <div className="row between">
                  <span>{formatMoney(p.price_minor)}</span>
                  <span className="muted">{p.available > 0 ? 'В наличии' : 'Нет'}</span>
                </div>
                <div className="row">
                  <button className="btn btn-secondary btn-compact" type="button" onClick={() => setSelectedId(p.id)}>
                    Подробнее
                  </button>
                  <button
                    className="btn btn-primary btn-compact"
                    type="button"
                    disabled={p.available <= 0 || addToCart.isPending}
                    onClick={() => addToCart.mutate({ product_id: p.id, qty: 1 })}
                  >
                    В корзину
                  </button>
                </div>
              </article>
            ))}
          </div>

          {selectedId && product.data && (
            <section className="card stack">
              <div className="row between">
                <h2>{product.data.brand} {product.data.name}</h2>
                <button className="btn btn-secondary btn-compact" type="button" onClick={() => setSelectedId(null)}>Закрыть</button>
              </div>
              <p>{product.data.description || 'Описание не заполнено'}</p>
              <p>
                {formatMoney(product.data.price_minor)} · доступно {product.data.available} {product.data.unit}
                {product.data.sku ? ` · арт. ${product.data.sku}` : ''}
              </p>
              {product.data.variants && product.data.variants.length > 1 && (
                <div className="stack">
                  <strong>Варианты объёма</strong>
                  <div className="list">
                    {product.data.variants.map((v) => (
                      <article key={v.id} className="list-item row between">
                        <div>
                          <strong>{v.volume_label || v.unit || 'стандарт'}</strong>
                          <p className="muted">
                            {formatMoney(v.price_minor)}
                            {v.available > 0 ? ` · в наличии ${v.available}` : ' · нет в наличии'}
                          </p>
                        </div>
                        <button
                          className="btn btn-primary btn-compact"
                          type="button"
                          disabled={v.available <= 0 || addToCart.isPending}
                          onClick={() => addToCart.mutate({ product_id: v.id, qty: 1 })}
                        >
                          В корзину
                        </button>
                      </article>
                    ))}
                  </div>
                </div>
              )}
              {(!product.data.variants || product.data.variants.length <= 1) && (
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={product.data.available <= 0 || addToCart.isPending}
                  onClick={() => addToCart.mutate({ product_id: product.data!.id, qty: 1 })}
                >
                  Добавить в корзину
                </button>
              )}
            </section>
          )}
        </section>
      )}

      {tab === 'cart' && (
        <section className="stack">
          {cart.isLoading && <div className="state-box">Загрузка корзины…</div>}
          {cart.data && cart.data.items.length === 0 && (
            <div className="state-box">Корзина пуста. <button className="btn btn-secondary btn-compact" type="button" onClick={() => setTab('catalog')}>В каталог</button></div>
          )}
          <div className="list">
            {cart.data?.items.map((it) => (
              <article key={it.product_id} className="list-item">
                <div className="row between">
                  <strong>{it.brand} {it.name}</strong>
                  <span>{formatMoney(it.line_total_minor)}</span>
                </div>
                <p>{formatMoney(it.price_minor)} · доступно {it.available}</p>
                <div className="row">
                  <label className="muted">Кол-во</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    defaultValue={it.qty}
                    style={{ width: 80 }}
                    onBlur={(e) => {
                      const qty = Number(e.target.value)
                      if (!Number.isFinite(qty) || qty === it.qty) return
                      setQty.mutate({ product_id: it.product_id, qty })
                    }}
                  />
                  <button
                    className="btn btn-secondary btn-compact"
                    type="button"
                    onClick={() => setQty.mutate({ product_id: it.product_id, qty: 0 })}
                  >
                    Удалить
                  </button>
                </div>
              </article>
            ))}
          </div>

          {cart.data && cart.data.items.length > 0 && (
            <section className="card stack">
              <div className="row between">
                <strong>Итого</strong>
                <strong>{formatMoney(cart.data.total_minor)}</strong>
              </div>
              <div className="field">
                <label>Салон самовывоза</label>
                <select
                  value={pickupId}
                  onChange={(e) => {
                    const id = e.target.value
                    setPickupId(id)
                    const b = pickup.find((x) => x.id === id)
                    if (b) setAddress([b.city, b.address_line, b.name].filter(Boolean).join(', '))
                  }}
                >
                  {pickup.length === 0 && <option value="">Салоны загружаются…</option>}
                  {pickup.map((b) => (
                    <option key={b.id} value={b.id}>{b.city} · {b.name} · {b.address_line}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Адрес / комментарий к салону</label>
                <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Город, улица, дом" />
              </div>
              <div className="field">
                <label>Оплата</label>
                <select value={payment} onChange={(e) => setPayment(e.target.value)}>
                  <option value="cash_on_delivery">Наличные при получении</option>
                  <option value="card">Карта при получении</option>
                </select>
              </div>
              <div className="field">
                <label>Комментарий</label>
                <input value={comment} onChange={(e) => setComment(e.target.value)} />
              </div>
              <p className="muted">Самовывоз в салоне. Профессиональные позиции клиенту недоступны.</p>
              <button
                className="btn btn-primary btn-block"
                type="button"
                disabled={checkout.isPending || address.trim().length < 5}
                onClick={() => checkout.mutate()}
              >
                Оформить заказ
              </button>
            </section>
          )}
        </section>
      )}

      {tab === 'orders' && (
        <section className="stack">
          {orders.isLoading && <div className="state-box">Загрузка заказов…</div>}
          {orders.isError && <div className="state-box error">Не удалось загрузить заказы</div>}
          {orders.data && orders.data.items.length === 0 && (
            <div className="state-box">Заказов ещё нет</div>
          )}
          <div className="list">
            {orders.data?.items.map((o) => (
              <article key={o.id} className="list-item">
                <div className="row between">
                  <strong>{formatMoney(o.total_minor)}</strong>
                  <span className={`badge ${statusBadgeClass(o.status)}`}>{clientOrderLabel(o.status)}</span>
                </div>
                <p>{new Date(o.created_at).toLocaleString('ru-RU')}</p>
                {o.delivery_address && <p className="muted">{o.delivery_address}</p>}
                <button
                  className="btn btn-secondary btn-compact"
                  type="button"
                  disabled={reorder.isPending}
                  onClick={() => reorder.mutate(o.id)}
                >
                  Повторить заказ
                </button>
              </article>
            ))}
          </div>
          <p className="muted">
            Повтор создаёт новую корзину с актуальными ценами и наличием — старая сумма не копируется.
          </p>
          <Link className="btn btn-secondary" to="/">На главную</Link>
        </section>
      )}
    </main>
  )
}
