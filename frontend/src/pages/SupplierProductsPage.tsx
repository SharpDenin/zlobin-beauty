import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useSupplierOrg, type CommerceProduct } from '@/shared/lib/commerce'
import { availabilityLabel, unitLabel } from '@/shared/lib/labels'
import { formatMoney } from '@/shared/lib/money'
import { productStateLabel, statusBadgeClass } from '@/shared/lib/status'
import { MediaImage } from '@/shared/ui/MediaImage'
import { Hint } from '@/shared/ui/Hint'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { Drawer } from '@/shared/ui/Drawer'
import { productAudienceLabel } from '@/pages/knowledge-helpers'
import { supplierHasActiveFilters, supplierProductMatches } from '@/pages/supplier-helpers'

function useCompact() {
  const [compact, setCompact] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : true,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const onChange = () => setCompact(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return compact
}

export function SupplierProductsPage() {
  const { accessToken } = useAuth()
  const { supplierOrgId, supplierOrg, orgs } = useSupplierOrg()
  const compact = useCompact()
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [audience, setAudience] = useState('')
  const [category, setCategory] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const products = useQuery({
    queryKey: ['commerce-products', supplierOrgId],
    queryFn: () =>
      apiRequest<{ items: CommerceProduct[] }>(
        `/v1/commerce/products?organization_id=${supplierOrgId}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && supplierOrgId),
  })
  const categoryList = useQuery({
    queryKey: ['commerce-product-categories'],
    queryFn: () => apiRequest<{ items: Array<{ id: string; name: string }> }>('/v1/commerce/product-categories', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const items = products.data?.items ?? []
  const categories = categoryList.data?.items ?? []
  const categoryNameById = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  )
  const filtered = useMemo(
    () => items.filter((p) => supplierProductMatches(
      { ...p, category: categoryNameById.get(p.category_id ?? '') ?? p.category },
      { q: search.trim().toLowerCase(), audience, category },
    )),
    [items, search, audience, category, categoryNameById],
  )
  const activeFilters = supplierHasActiveFilters(search, audience, category)

  const filterFields = (
    <>
      <label className="field">
        <span>Аудитория</span>
        <select value={audience} onChange={(e) => setAudience(e.target.value)} aria-label="Аудитория">
          <option value="">Все</option>
          <option value="all">Для домашнего ухода</option>
          <option value="professional_only">Только для салонов</option>
        </select>
      </label>
      <label className="field">
        <span>Категория</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Категория">
          <option value="">Все категории</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
    </>
  )

  if (orgs.isLoading) {
    return <main className="page"><div className="skeleton skeleton-card" aria-busy="true" /></main>
  }

  if (!supplierOrgId) {
    return (
      <main className="page">
        <EmptyState
          title="Сначала создайте поставщика"
          text="Онбординг откроет каталог товаров и заказы салонов."
          action={<Link className="btn btn-primary" to="/supplier">Онбординг</Link>}
        />
      </main>
    )
  }

  return (
    <main className="page stack supplier-catalog">
      <div className="row between wrap">
        <div className="stack-sm">
          <h1>Товары <Hint id="product-audience" title="Аудитория товара">Для домашнего ухода — клиенты и мастера. Только для салонов — профессионалы.</Hint></h1>
          <p className="muted">{supplierOrg?.organization.name}</p>
        </div>
        <Link className="btn btn-primary" to="/supplier/products/new">Добавить</Link>
      </div>

      <div className="tabs">
        <Link className="active" to="/supplier/products">Товары</Link>
        <Link to="/supplier/orders">Заказы</Link>
      </div>

      <form
        className="shop-search"
        onSubmit={(e) => {
          e.preventDefault()
          setSearch(q.trim())
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по названию, бренду или артикулу" aria-label="Поиск" />
        <button className="btn btn-primary" type="submit">Найти</button>
        {compact ? (
          <button className="btn btn-secondary" type="button" onClick={() => setFiltersOpen(true)}>
            Фильтры{activeFilters ? ' · выбраны' : ''}
          </button>
        ) : null}
      </form>

      {compact ? (
        <Drawer open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Фильтры" label="Фильтры каталога">
          <div className="shop-filters shop-filters--drawer">{filterFields}</div>
          <div className="row wrap">
            <button className="btn btn-secondary" type="button" onClick={() => { setAudience(''); setCategory(''); setQ(''); setSearch('') }}>
              Сбросить
            </button>
            <button className="btn btn-primary" type="button" onClick={() => setFiltersOpen(false)}>Применить</button>
          </div>
        </Drawer>
      ) : (
        <div className="shop-filters" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>{filterFields}</div>
      )}

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
      {products.isError && <ErrorBanner error={products.error} fallbackTitle="Не удалось загрузить товары" />}
      {products.data && filtered.length === 0 && (
        <EmptyState
          title={activeFilters ? 'Нет товаров по фильтрам' : 'Товаров пока нет'}
          text={activeFilters ? 'Сбросьте фильтры или измените запрос.' : 'Добавьте первый товар для салонов и домашнего ухода.'}
          action={
            activeFilters ? (
              <button className="btn btn-secondary" type="button" onClick={() => { setAudience(''); setCategory(''); setQ(''); setSearch('') }}>
                Сбросить фильтры
              </button>
            ) : (
              <Link className="btn btn-primary" to="/supplier/products/new">Создать товар</Link>
            )
          }
        />
      )}

      <div className="cards-grid products">
        {filtered.map((p) => {
          const state = p.published === false ? 'draft' : p.for_sale === false ? 'not_for_sale' : 'for_sale'
          return (
            <Link key={p.id} to={`/supplier/products/${p.id}`} className="product-card shop-product-card">
              <div className="media-frame media-frame--product">
                <MediaImage mediaId={p.photo_media_id} token={accessToken} alt={p.name} fallback={(p.brand || p.name).slice(0, 2).toUpperCase()} />
              </div>
              <p className="muted shop-product-meta">
                {[p.brand, categoryNameById.get(p.category_id ?? '') ?? p.category, p.volume_label || unitLabel(p.unit)].filter(Boolean).join(' · ')}
              </p>
              <strong>{p.name}</strong>
              <span className="badge badge-default">{productAudienceLabel(p.audience)}</span>
              <div className="row between wrap">
                <span className="shop-price">{formatMoney(p.price_minor)}</span>
                <span className={`badge ${statusBadgeClass(state)}`}>{productStateLabel(state)}</span>
              </div>
              <span className="muted">{availabilityLabel(p.for_sale, p.published)}</span>
              <span className="btn btn-secondary">Открыть</span>
            </Link>
          )
        })}
      </div>
    </main>
  )
}
