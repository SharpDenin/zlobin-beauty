import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  fetchPickupBranches,
  fetchSupplier,
  newIdempotencyKey,
  PAYMENT_METHOD_OPTIONS,
  paymentMethodLabel,
  useBuyerOrg,
  useEnsureLocation,
  type BranchCard,
  type CommerceProduct,
  type SupplierOrder,
} from '@/shared/lib/commerce'
import { addToCart, cartCount, cartTotal, clearCart, loadCart, saveCart, setCartQty, type CartLine } from '@/shared/lib/cart'
import { availabilityLabel, unitLabel } from '@/shared/lib/labels'
import { formatMoney } from '@/shared/lib/money'
import { MediaImage } from '@/shared/ui/MediaImage'
import { Modal } from '@/shared/ui/Modal'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { useToast } from '@/shared/ui/Toast'
import { productAudienceLabel } from '@/pages/knowledge-helpers'
import { useMessenger } from '@/features/messenger/MessengerProvider'
import '@/features/cart/cart.css'

export function CosmeticsSupplierPage() {
  const { supplierId = '' } = useParams()
  const { accessToken } = useAuth()
  const messenger = useMessenger()
  const navigate = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const { buyerOrgId, buyerOrg, orgs } = useBuyerOrg()
  const { locations, ensure, locationId } = useEnsureLocation(buyerOrgId)
  const [cart, setCart] = useState<CartLine[]>(() => (supplierId ? loadCart(supplierId) : []))
  const [comment, setComment] = useState('')
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [branchQuery, setBranchQuery] = useState('')
  const [destinationBranchId, setDestinationBranchId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<string>('cash')
  const [error, setError] = useState<unknown>(null)
  const [ok, setOk] = useState<string | null>(null)
  // One idempotency key per distinct order payload. A retry of the same payload after an
  // ambiguous failure (timeout, dropped response) reuses the key and the server dedupes it;
  // editing the cart / branch / payment starts a new attempt with a new key.
  const orderAttempt = useRef<{ fingerprint: string; key: string } | null>(null)
  const submitLock = useRef(false)
  const idempotencyKeyFor = (fingerprint: string): string => {
    if (orderAttempt.current?.fingerprint !== fingerprint) {
      orderAttempt.current = { fingerprint, key: newIdempotencyKey() }
    }
    return orderAttempt.current.key
  }

  useEffect(() => {
    if (supplierId) setCart(loadCart(supplierId))
  }, [supplierId])

  useEffect(() => {
    if (supplierId) saveCart(supplierId, cart)
  }, [supplierId, cart])

  const supplier = useQuery({
    queryKey: ['supplier', supplierId],
    queryFn: () => fetchSupplier(accessToken, supplierId),
    enabled: Boolean(accessToken && supplierId),
  })

  const products = useQuery({
    queryKey: ['commerce-products', supplierId],
    queryFn: () =>
      apiRequest<{ items: CommerceProduct[] }>(
        `/v1/commerce/products?organization_id=${encodeURIComponent(supplierId)}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && supplierId),
  })

  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null)

  useEffect(() => {
    if (!checkoutOpen || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setGeo(null),
      { timeout: 4000 },
    )
  }, [checkoutOpen])

  const pickupBranches = useQuery({
    queryKey: ['pickup-branches', buyerOrgId, geo?.lat, geo?.lng],
    queryFn: () => fetchPickupBranches(accessToken, buyerOrgId, buyerOrg?.branches, geo),
    enabled: Boolean(accessToken && buyerOrgId && checkoutOpen),
  })

  const filteredBranches = useMemo(() => {
    const items = pickupBranches.data ?? []
    const q = branchQuery.trim().toLowerCase()
    if (!q) return items
    return items.filter((b) =>
      [b.name, b.city, b.address_line, b.phone, b.timezone]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    )
  }, [pickupBranches.data, branchQuery])

  useEffect(() => {
    if (!destinationBranchId && (pickupBranches.data?.length ?? 0) === 1) {
      setDestinationBranchId(pickupBranches.data![0].id)
    }
  }, [pickupBranches.data, destinationBranchId])

  const selectedBranch = useMemo(
    () => (pickupBranches.data ?? []).find((b) => b.id === destinationBranchId) ?? null,
    [pickupBranches.data, destinationBranchId],
  )

  const createOrder = useMutation({
    mutationFn: async () => {
      if (!buyerOrgId) throw new ApiError('Нет организации салона', 'validation_error', 400)
      if (!destinationBranchId) throw new ApiError('Выберите филиал для получения', 'validation_error', 400)
      let loc = locationId || locations.data?.items[0]?.id
      if (!loc) {
        const created = await ensure.mutateAsync()
        loc = created.id
      }
      if (!loc) throw new ApiError('Не удалось подготовить склад доставки', 'validation_error', 400)
      if (cart.length === 0) throw new ApiError('Корзина пуста', 'validation_error', 400)
      const items = cart.map((c) => ({ product_id: c.product.id, qty: c.qty }))
      const orderComment = comment.trim() || 'Заказ косметики'
      const idempotencyKey = idempotencyKeyFor(
        JSON.stringify([buyerOrgId, supplierId, loc, destinationBranchId, paymentMethod, orderComment, items]),
      )
      return apiRequest<SupplierOrder>('/v1/commerce/supplier-orders', {
        token: accessToken,
        idempotencyKey,
        body: {
          buyer_org_id: buyerOrgId,
          supplier_org_id: supplierId,
          location_id: loc,
          destination_branch_id: destinationBranchId,
          payment_method: paymentMethod,
          comment: orderComment,
          items,
          idempotency_key: idempotencyKey,
        },
      })
    },
    onSuccess: async (order) => {
      submitLock.current = false
      setOk('Заказ оформлен')
      setError(null)
      setCart([])
      clearCart(supplierId)
      setCheckoutOpen(false)
      setComment('')
      setDestinationBranchId('')
      setPaymentMethod('cash')
      setBranchQuery('')
      orderAttempt.current = null
      await qc.invalidateQueries({ queryKey: ['commerce-supplier-orders'] })
      toast.success('Заказ оформлен')
      const highlight = order?.id ? `?highlight=${encodeURIComponent(order.id)}` : ''
      navigate(`/cosmetics/orders${highlight}`)
    },
    // Failure keeps the cart, the form and the idempotency key: nothing was persisted
    // (the server creates the order and reserves stock atomically), so a retry is safe.
    onError: (e) => {
      submitLock.current = false
      setError(e)
    },
  })

  const submitOrder = () => {
    if (createOrder.isPending || submitLock.current) return
    submitLock.current = true
    createOrder.mutate()
  }
  const published = useMemo(
    () => (products.data?.items ?? []).filter((p) => p.published !== false),
    [products.data],
  )

  if (orgs.isLoading) return <main className="page"><div className="skeleton skeleton-card" aria-busy="true" /></main>
  if (!buyerOrgId) {
    return (
      <main className="page">
        <EmptyState
          title="Нужен салон"
          text="Создайте салон в кабинете мастера."
          action={<Link className="btn btn-primary" to="/master">Кабинет</Link>}
        />
      </main>
    )
  }

  const title = supplier.data?.name || 'Каталог поставщика'
  const subtotal = cartTotal(cart)
  const deliveryCost = 0
  const total = subtotal + deliveryCost
  const count = cartCount(cart)

  return (
    <main className="page stack">
      <div className="row between">
        <div className="stack-sm">
          <Link className="btn btn-ghost btn-compact" to="/cosmetics">← Поставщики</Link>
          <h1>{title}</h1>
          {supplier.data?.city && <p className="muted">{supplier.data.city}</p>}
          {supplier.data?.delivery_note && <p className="muted">Доставка: {supplier.data.delivery_note}</p>}
        </div>
        <div className="row">
          <button
            className="btn btn-secondary btn-compact"
            type="button"
            data-testid="write-supplier"
            onClick={async () => {
              try {
                await messenger.start({
                  type: 'master_supplier',
                  supplier_organization_id: supplierId,
                })
              } catch (e) {
                setError(e)
              }
            }}
          >
            Написать поставщику
          </button>
          <Link className="btn btn-secondary btn-compact" to="/cosmetics/orders">Заказы</Link>
        </div>
      </div>

      <ErrorBanner error={error} fallbackTitle="Не удалось оформить заказ" />
      {ok && <p className="muted" role="status">{ok}</p>}

      {products.isLoading && (
        <div className="cards-grid products" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="product-card">
              <div className="media-frame media-frame--product"><div className="media-skeleton" /></div>
              <div className="skeleton skeleton-line" />
            </div>
          ))}
        </div>
      )}
      {products.isError && <ErrorBanner error={products.error} fallbackTitle="Не удалось загрузить каталог" />}
      {!products.isLoading && published.length === 0 && (
        <EmptyState title="Товаров пока нет" text="Поставщик ещё не опубликовал продукцию." />
      )}

      <div className="cards-grid products">
        {published.map((p) => (
          <article key={p.id} className="product-card">
            <Link to={`/cosmetics/products/${p.id}`}>
              <div className="media-frame media-frame--product">
                <MediaImage mediaId={p.photo_media_id} token={accessToken} alt={p.name} fallback={(p.brand || p.name).slice(0, 2).toUpperCase()} />
              </div>
            </Link>
            <div className="stack-sm">
              <Link to={`/cosmetics/products/${p.id}`}><strong>{p.name}</strong></Link>
              <p className="muted">{[p.brand, p.volume_label || unitLabel(p.unit)].filter(Boolean).join(' · ')}</p>
              <span className="badge badge-default">{productAudienceLabel(p.audience)}</span>
              <div className="row between">
                <strong>{formatMoney(p.price_minor)}</strong>
                <span className="chip badge-default">{availabilityLabel(p.for_sale, p.published)}</span>
              </div>
              {typeof p.delivery_days === 'number' && (
                <p className="muted">Доставка ≈ {p.delivery_days} дн.</p>
              )}
              <button
                className="btn btn-secondary btn-compact"
                type="button"
                onClick={() => setCart((prev) => addToCart(prev, p))}
              >
                В корзину
              </button>
            </div>
          </article>
        ))}
      </div>

      {count > 0 && (
        <div className="cart-bar">
          <div className="stack-sm">
            <strong>{count} поз. · {formatMoney(total)}</strong>
            <span className="muted">{buyerOrg?.organization.name}</span>
          </div>
          <button className="btn btn-primary" type="button" onClick={() => setCheckoutOpen(true)}>
            Оформить
          </button>
        </div>
      )}

      <Modal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} title="Оформление заказа" size="lg">
            {cart.length === 0 ? (
              <EmptyState title="Корзина пуста" text="Добавьте товары из каталога поставщика." />
            ) : (
            <div className="list cart-lines">
              {cart.map((line) => (
                <article key={line.product.id} className="cart-line" data-testid="cart-line">
                  <div className="cart-line-head">
                    <strong className="cart-line-title">
                      {line.product.brand ? `${line.product.brand} · ` : ''}{line.product.name}
                    </strong>
                    <span>{formatMoney(line.product.price_minor * line.qty)}</span>
                  </div>
                  <div className="cart-line-controls">
                    <div className="cart-qty-stepper" role="group" aria-label={`Количество: ${line.product.name}`}>
                      <button
                        className="btn btn-secondary cart-qty-btn"
                        type="button"
                        aria-label="Уменьшить"
                        disabled={createOrder.isPending}
                        onClick={() => setCart((prev) => setCartQty(prev, line.product.id, line.qty - 1))}
                      >
                        −
                      </button>
                      <span className="cart-qty-value" aria-live="polite">{line.qty}</span>
                      <button
                        className="btn btn-secondary cart-qty-btn"
                        type="button"
                        aria-label="Увеличить"
                        disabled={createOrder.isPending}
                        onClick={() => setCart((prev) => setCartQty(prev, line.product.id, line.qty + 1))}
                      >
                        +
                      </button>
                    </div>
                    <button
                      className="btn btn-secondary cart-line-remove"
                      type="button"
                      aria-label={`Удалить ${line.product.name}`}
                      disabled={createOrder.isPending}
                      onClick={() => setCart((prev) => setCartQty(prev, line.product.id, 0))}
                    >
                      Удалить
                    </button>
                  </div>
                </article>
              ))}
            </div>
            )}

            <section className="stack-sm">
              <h3>Филиал получения</h3>
              <p className="muted">
                {geo
                  ? 'Предлагаем ближайший доступный салон. Можно выбрать другой.'
                  : 'Геолокация недоступна — выберите филиал по городу и адресу.'}
              </p>
              <div className="field">
                <label htmlFor="branch-search">Поиск филиала</label>
                <input
                  id="branch-search"
                  value={branchQuery}
                  onChange={(e) => setBranchQuery(e.target.value)}
                  placeholder="Название, город, адрес…"
                />
              </div>
              {pickupBranches.isLoading && <div className="state-box">Загрузка филиалов…</div>}
              {pickupBranches.isError && <ErrorBanner error={pickupBranches.error} fallbackTitle="Не удалось загрузить филиалы" />}
              {!pickupBranches.isLoading && filteredBranches.length === 0 && (
                <div className="state-box">Нет доступных филиалов с самовывозом. Включите pickup у филиала салона.</div>
              )}
              <div className="list">
                {filteredBranches.map((b) => (
                  <BranchSelectCard
                    key={b.id}
                    branch={b}
                    selected={destinationBranchId === b.id}
                    onSelect={() => setDestinationBranchId(b.id)}
                  />
                ))}
              </div>
            </section>

            <div className="field">
              <label htmlFor="payment-method">Способ оплаты</label>
              <select
                id="payment-method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                {PAYMENT_METHOD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {paymentMethod === 'card' && (
                <p className="hint">Онлайн-оплата будет подключена позже</p>
              )}
            </div>

            <div className="field">
              <label htmlFor="comment">Комментарий</label>
              <input id="comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Пожелания к доставке" />
            </div>

            <section className="order-summary stack-sm">
              <h3>Итого</h3>
              <div className="row between"><span>Подытог</span><strong>{formatMoney(subtotal)}</strong></div>
              <div className="row between"><span>Доставка</span><strong>{formatMoney(deliveryCost)}</strong></div>
              <div className="row between"><span>Всего</span><strong>{formatMoney(total)}</strong></div>
              <div className="row between">
                <span>Оплата</span>
                <strong>{paymentMethodLabel(paymentMethod)}</strong>
              </div>
              {selectedBranch && (
                <p className="muted">Получение: {selectedBranch.name}, {selectedBranch.city}</p>
              )}
            </section>

            <button
              className="btn btn-primary btn-block"
              type="button"
              disabled={createOrder.isPending || cart.length === 0 || !destinationBranchId}
              onClick={submitOrder}
            >
              {createOrder.isPending ? 'Отправляем…' : 'Подтвердить заказ'}
            </button>
      </Modal>
    </main>
  )
}

function BranchSelectCard({
  branch,
  selected,
  onSelect,
}: {
  branch: BranchCard
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={`list-item branch-select-card${selected ? ' selected' : ''}`}
      onClick={onSelect}
    >
      <div className="row between">
        <strong>{branch.name}</strong>
        {selected && <span className="chip badge-confirmed">Выбран</span>}
      </div>
      <p className="muted">{[branch.city, branch.address_line].filter(Boolean).join(' · ')}</p>
      <p className="muted">
        {[branch.timezone, branch.phone].filter(Boolean).join(' · ')}
      </p>
    </button>
  )
}
