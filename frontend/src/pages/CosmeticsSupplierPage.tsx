import { Link, useParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  fetchSupplier,
  useBuyerOrg,
  useEnsureLocation,
  type CommerceProduct,
} from '@/shared/lib/commerce'
import { addToCart, cartCount, cartTotal, clearCart, loadCart, saveCart, setCartQty, type CartLine } from '@/shared/lib/cart'
import { availabilityLabel, unitLabel } from '@/shared/lib/labels'
import { formatMoney } from '@/shared/lib/money'
import { MediaImage } from '@/shared/ui/MediaImage'

export function CosmeticsSupplierPage() {
  const { supplierId = '' } = useParams()
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const { buyerOrgId, buyerOrg, orgs } = useBuyerOrg()
  const { locations, ensure, locationId } = useEnsureLocation(buyerOrgId)
  const [cart, setCart] = useState<CartLine[]>(() => (supplierId ? loadCart(supplierId) : []))
  const [comment, setComment] = useState('')
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

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

  const createOrder = useMutation({
    mutationFn: async () => {
      if (!buyerOrgId) throw new ApiError('Нет организации салона', 'validation_error', 400)
      let loc = locationId || locations.data?.items[0]?.id
      if (!loc) {
        const created = await ensure.mutateAsync()
        loc = created.id
      }
      if (!loc) throw new ApiError('Не удалось подготовить склад доставки', 'validation_error', 400)
      if (cart.length === 0) throw new ApiError('Корзина пуста', 'validation_error', 400)
      return apiRequest('/v1/commerce/supplier-orders', {
        token: accessToken,
        body: {
          buyer_org_id: buyerOrgId,
          supplier_org_id: supplierId,
          location_id: loc,
          comment: comment.trim() || 'Заказ косметики',
          items: cart.map((c) => ({ product_id: c.product.id, qty: c.qty })),
        },
      })
    },
    onSuccess: async () => {
      setOk('Заказ оформлен')
      setError(null)
      setCart([])
      clearCart(supplierId)
      setCheckoutOpen(false)
      setComment('')
      await qc.invalidateQueries({ queryKey: ['commerce-supplier-orders'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось оформить заказ'),
  })

  const published = useMemo(
    () => (products.data?.items ?? []).filter((p) => p.published !== false),
    [products.data],
  )

  if (orgs.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>
  if (!buyerOrgId) {
    return (
      <main className="page">
        <div className="empty-state">
          <h2>Нужен салон</h2>
          <p>Создайте салон в кабинете мастера.</p>
          <Link className="btn btn-primary" to="/master">Кабинет</Link>
        </div>
      </main>
    )
  }

  const title = supplier.data?.name || 'Каталог поставщика'
  const total = cartTotal(cart)
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
        <Link className="btn btn-secondary btn-compact" to="/cosmetics/orders">Заказы</Link>
      </div>

      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}

      {products.isLoading && <div className="state-box">Загрузка товаров…</div>}
      {products.isError && <div className="state-box error">Не удалось загрузить каталог</div>}
      {!products.isLoading && published.length === 0 && (
        <div className="empty-state">
          <h2>Товаров пока нет</h2>
          <p>Поставщик ещё не опубликовал продукцию.</p>
        </div>
      )}

      <div className="cards-grid products">
        {published.map((p) => (
          <article key={p.id} className="product-card">
            <Link to={`/cosmetics/products/${p.id}`}>
              <div className="product-media">
                {p.photo_media_id ? (
                  <MediaImage mediaId={p.photo_media_id} token={accessToken} alt={p.name} />
                ) : (
                  <span>{p.brand || 'Фото'}</span>
                )}
              </div>
            </Link>
            <div className="stack-sm">
              <Link to={`/cosmetics/products/${p.id}`}><strong>{p.name}</strong></Link>
              <p className="muted">{[p.brand, p.volume_label || unitLabel(p.unit)].filter(Boolean).join(' · ')}</p>
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

      {checkoutOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setCheckoutOpen(false)}>
          <div className="modal-sheet stack" onClick={(e) => e.stopPropagation()}>
            <div className="row between">
              <h2>Корзина</h2>
              <button className="btn btn-secondary btn-compact" type="button" onClick={() => setCheckoutOpen(false)}>
                Закрыть
              </button>
            </div>
            <div className="list">
              {cart.map((line) => (
                <article key={line.product.id} className="list-item">
                  <div className="row between">
                    <strong>{line.product.brand ? `${line.product.brand} · ` : ''}{line.product.name}</strong>
                    <span>{formatMoney(line.product.price_minor * line.qty)}</span>
                  </div>
                  <div className="field">
                    <label>Количество</label>
                    <input
                      type="number"
                      min={0}
                      value={line.qty}
                      onChange={(e) => setCart((prev) => setCartQty(prev, line.product.id, Number(e.target.value)))}
                    />
                  </div>
                </article>
              ))}
            </div>
            <p>Итого: <strong>{formatMoney(total)}</strong></p>
            <div className="field">
              <label htmlFor="comment">Комментарий</label>
              <input id="comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Пожелания к доставке" />
            </div>
            <p className="muted">Доставка на склад салона будет подготовлена автоматически.</p>
            <button
              className="btn btn-primary btn-block"
              type="button"
              disabled={createOrder.isPending || cart.length === 0}
              onClick={() => createOrder.mutate()}
            >
              {createOrder.isPending ? 'Отправляем…' : 'Подтвердить заказ'}
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
