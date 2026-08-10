import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import type { CommerceProduct } from '@/shared/lib/commerce'
import { addToCart, loadCart, saveCart } from '@/shared/lib/cart'
import { availabilityLabel, unitLabel } from '@/shared/lib/labels'
import { formatMoney } from '@/shared/lib/money'
import { MediaImage } from '@/shared/ui/MediaImage'
import { useState } from 'react'

export function CosmeticsProductPage() {
  const { productId = '' } = useParams()
  const { accessToken } = useAuth()
  const navigate = useNavigate()
  const [added, setAdded] = useState(false)

  const product = useQuery({
    queryKey: ['commerce-product', productId],
    queryFn: () => apiRequest<CommerceProduct>(`/v1/commerce/products/${productId}`, { token: accessToken }),
    enabled: Boolean(accessToken && productId),
  })

  if (product.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>
  if (product.isError || !product.data) {
    return (
      <main className="page stack">
        <div className="state-box error">Товар не найден</div>
        <Link className="btn btn-secondary" to="/cosmetics">К поставщикам</Link>
      </main>
    )
  }

  const p = product.data
  const supplierId = p.organization_id

  function add() {
    const next = addToCart(loadCart(supplierId), p)
    saveCart(supplierId, next)
    setAdded(true)
  }

  return (
    <main className="page stack">
      <Link className="btn btn-ghost btn-compact" to={`/cosmetics/${supplierId}`}>← К каталогу</Link>
      <section className="product-card">
        <div className="product-media" style={{ aspectRatio: '1 / 1' }}>
          {p.photo_media_id ? (
            <MediaImage mediaId={p.photo_media_id} token={accessToken} alt={p.name} />
          ) : (
            <span>Нет фото</span>
          )}
        </div>
        <div className="stack-sm">
          {p.brand && <span className="chip badge-default">{p.brand}</span>}
          <h1>{p.name}</h1>
          <strong style={{ fontSize: '1.35rem' }}>{formatMoney(p.price_minor)}</strong>
          <p className="muted">
            {[p.volume_label || unitLabel(p.unit), p.category].filter(Boolean).join(' · ')}
          </p>
          <span className="chip badge-confirmed">{availabilityLabel(p.for_sale, p.published)}</span>
          {typeof p.delivery_days === 'number' && (
            <p>Срок доставки: около {p.delivery_days} дн.</p>
          )}
          {p.description && <p>{p.description}</p>}
        </div>
        <div className="row">
          <button className="btn btn-primary" type="button" onClick={add}>
            {added ? 'Добавлено' : 'В корзину'}
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => {
              add()
              void navigate(`/cosmetics/${supplierId}`)
            }}
          >
            В каталог с корзиной
          </button>
        </div>
        {added && <div className="state-box success">Товар в корзине. Оформите заказ в каталоге поставщика.</div>}
      </section>
    </main>
  )
}
