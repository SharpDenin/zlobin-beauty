import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useSupplierOrg, type CommerceProduct } from '@/shared/lib/commerce'
import { availabilityLabel, unitLabel } from '@/shared/lib/labels'
import { formatMoney } from '@/shared/lib/money'
import { productStateLabel, statusBadgeClass } from '@/shared/lib/status'
import { MediaImage } from '@/shared/ui/MediaImage'

export function SupplierProductsPage() {
  const { accessToken } = useAuth()
  const { supplierOrgId, supplierOrg, orgs } = useSupplierOrg()

  const products = useQuery({
    queryKey: ['commerce-products', supplierOrgId],
    queryFn: () =>
      apiRequest<{ items: CommerceProduct[] }>(
        `/v1/commerce/products?organization_id=${supplierOrgId}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && supplierOrgId),
  })

  if (orgs.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>

  if (!supplierOrgId) {
    return (
      <main className="page">
        <div className="empty-state">
          <h2>Сначала создайте поставщика</h2>
          <Link className="btn btn-primary" to="/supplier">Онбординг</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="page stack">
      <div className="row between">
        <div className="stack-sm">
          <h1>Товары</h1>
          <p className="muted">{supplierOrg?.organization.name}</p>
        </div>
        <Link className="btn btn-primary" to="/supplier/products/new">Добавить</Link>
      </div>

      <div className="tabs">
        <Link className="active" to="/supplier/products">Товары</Link>
        <Link to="/supplier/orders">Заказы</Link>
      </div>

      {products.isLoading && <div className="state-box">Загрузка…</div>}
      {products.isError && <div className="state-box error">Не удалось загрузить товары</div>}
      {products.data && products.data.items.length === 0 && (
        <div className="empty-state">
          <h2>Каталог пуст</h2>
          <p>Добавьте первый товар для салонов.</p>
          <Link className="btn btn-primary" to="/supplier/products/new">Создать товар</Link>
        </div>
      )}

      <div className="cards-grid products">
        {products.data?.items.map((p) => {
          const state = p.published === false ? 'draft' : p.for_sale === false ? 'not_for_sale' : 'for_sale'
          return (
            <Link key={p.id} to={`/supplier/products/${p.id}`} className="product-card">
              <div className="product-media">
                {p.photo_media_id ? (
                  <MediaImage mediaId={p.photo_media_id} token={accessToken} alt={p.name} />
                ) : (
                  <span>Нет фото</span>
                )}
              </div>
              <div className="stack-sm">
                <strong>{p.name}</strong>
                <p className="muted">{[p.brand, p.volume_label || unitLabel(p.unit)].filter(Boolean).join(' · ')}</p>
                <div className="row between">
                  <span>{formatMoney(p.price_minor)}</span>
                  <span className={`badge ${statusBadgeClass(state)}`}>{productStateLabel(state)}</span>
                </div>
                <span className="muted">{availabilityLabel(p.for_sale, p.published)}</span>
              </div>
            </Link>
          )
        })}
      </div>
    </main>
  )
}
