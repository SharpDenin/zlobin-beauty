import { Link, useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { hasMasterAccess, hasSalonAdmin, hasSupplierAccess, useAuth } from '@/features/auth/AuthProvider'
import { CatalogTreeAccordion } from '@/features/knowledge/CatalogTree'
import { KnowledgeCard, KnowledgeCardSkeleton } from '@/features/knowledge/KnowledgeCard'
import { SearchableMultiSelect } from '@/features/knowledge/SearchableMultiSelect'
import {
  emptyFilters,
  filtersActive,
  filtersFromSearch,
  filtersToSearch,
  knowledgeApiQuery,
  type KnowledgeArticle,
  type KnowledgeFacet,
  type KnowledgeFilters,
  type KnowledgeListResponse,
} from '@/features/knowledge/types'
import { buildKnowledgeCategoryTree, knowledgeEmptyTitle, knowledgeSectionToneClass } from '@/pages/knowledge-helpers'
import { productStateLabel, statusBadgeClass } from '@/shared/lib/status'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Drawer } from '@/shared/ui/Drawer'
import '@/features/knowledge/knowledge-tones.css'

type Facets = {
  categories: KnowledgeFacet[]
  brands: KnowledgeFacet[]
  suppliers: KnowledgeFacet[]
}

type ProductOpt = { id: string; name: string; brand?: string }
type CategoryOpt = { id: string; name: string }

const PAGE_SIZE = 12
const EPICA_SERIES = ['COLORSHADE', 'COLORDREAM', 'COLORSOLUTION', 'OVERCOLOR', 'PROXY', 'OXY ACTIVE']

export function KnowledgeListPage() {
  const { accessToken, user } = useAuth()
  const isSupplier = hasSupplierAccess(user) && !hasMasterAccess(user)
  if (isSupplier) return <SupplierKnowledgeHome />
  const professional = hasMasterAccess(user) || hasSalonAdmin(user)
  return <KnowledgeHub token={accessToken} professional={professional} />
}

function KnowledgeHub({ token, professional }: { token: string | null; professional: boolean }) {
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => filtersFromSearch(params), [params])
  const [search, setSearch] = useState(filters.q)
  const [drawer, setDrawer] = useState(false)
  const [productOpts, setProductOpts] = useState<ProductOpt[]>([])
  const [productQ, setProductQ] = useState('')
  const browseHome = !filtersActive(filters)

  useEffect(() => { setSearch(filters.q) }, [filters.q])

  useEffect(() => {
    const next = search.trim()
    if (next === filters.q) return
    const t = window.setTimeout(() => {
      setParams(filtersToSearch({ ...filters, q: next }), { replace: true })
    }, 300)
    return () => window.clearTimeout(t)
  }, [search, filters, setParams])

  function setFilters(next: KnowledgeFilters) {
    setParams(filtersToSearch(next), { replace: false })
  }
  function patch(partial: Partial<KnowledgeFilters>) {
    setFilters({ ...filters, ...partial })
  }

  const facets = useQuery({
    queryKey: ['knowledge-facets'],
    queryFn: () => apiRequest<Facets>('/v1/knowledge/facets', { token }),
    enabled: Boolean(token),
  })

  const productCategories = useQuery({
    queryKey: ['kb-product-categories'],
    queryFn: () => apiRequest<{ items: CategoryOpt[] }>('/v1/commerce/product-categories', { token }),
    enabled: Boolean(token),
  })

  const productSearch = useQuery({
    queryKey: ['kb-product-search', productQ],
    queryFn: () =>
      apiRequest<{ items: ProductOpt[] }>(
        `/v1/commerce/shop/products?q=${encodeURIComponent(productQ)}&limit=20`,
        { token },
      ),
    enabled: Boolean(token && (productQ.trim().length >= 2 || filters.product_id.length > 0)),
  })

  useEffect(() => {
    const items = productSearch.data?.items ?? []
    if (!items.length) return
    setProductOpts((prev) => {
      const map = new Map(prev.map((p) => [p.id, p]))
      for (const p of items) map.set(p.id, p)
      return [...map.values()]
    })
  }, [productSearch.data])

  const list = useQuery({
    queryKey: ['knowledge', filters, 0],
    queryFn: () =>
      apiRequest<KnowledgeListResponse>(`/v1/knowledge${knowledgeApiQuery(filters, { limit: PAGE_SIZE, offset: 0 })}`, { token }),
    enabled: Boolean(token),
    placeholderData: keepPreviousData,
  })

  const recommended = useQuery({
    queryKey: ['knowledge-recommended'],
    queryFn: () =>
      apiRequest<KnowledgeListResponse>('/v1/knowledge?sort=recommended&limit=6', { token }),
    enabled: Boolean(token && browseHome),
  })
  const favoritesSec = useQuery({
    queryKey: ['knowledge-fav-sec'],
    queryFn: () =>
      apiRequest<KnowledgeListResponse>('/v1/knowledge?favorites=1&limit=6', { token }),
    enabled: Boolean(token && browseHome),
  })
  const newest = useQuery({
    queryKey: ['knowledge-new-sec'],
    queryFn: () =>
      apiRequest<KnowledgeListResponse>('/v1/knowledge?sort=new&limit=6', { token }),
    enabled: Boolean(token && browseHome),
  })

  const [extra, setExtra] = useState<KnowledgeArticle[]>([])
  const [offset, setOffset] = useState(PAGE_SIZE)
  useEffect(() => {
    setExtra([])
    setOffset(PAGE_SIZE)
  }, [filters])

  const fav = useMutation({
    mutationFn: async (a: KnowledgeArticle) => {
      if (a.favorite) {
        await apiRequest(`/v1/knowledge/${a.id}/favorite`, { method: 'DELETE', token })
        return { ...a, favorite: false }
      }
      return apiRequest<KnowledgeArticle>(`/v1/knowledge/${a.id}/favorite`, { method: 'POST', token })
    },
    onMutate: async (a) => {
      await qc.cancelQueries({ queryKey: ['knowledge'] })
      const patchFav = (art: KnowledgeArticle) => (art.id === a.id ? { ...art, favorite: !art.favorite } : art)
      qc.setQueriesData({ queryKey: ['knowledge'] }, (old: unknown) => {
        if (!old || typeof old !== 'object' || !('items' in old)) return old
        const data = old as KnowledgeListResponse
        return { ...data, items: data.items.map(patchFav) }
      })
    },
    onError: () => { void qc.invalidateQueries({ queryKey: ['knowledge'] }) },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['knowledge'] })
      void qc.invalidateQueries({ queryKey: ['knowledge-fav-sec'] })
    },
  })

  const items = [...(list.data?.items ?? []), ...extra]
  const total = list.data?.total ?? 0
  const hasMore = items.length < total

  const cats = facets.data?.categories ?? []
  const brands = facets.data?.brands ?? []
  const catalogTree = useMemo(() => buildKnowledgeCategoryTree(cats), [cats])
  const selectedCategory = filters.category[0] ?? ''
  const epicaSelected = filters.brand.some((brand) => brand.toLowerCase() === 'epica professional')
  const suppliers = facets.data?.suppliers ?? []
  const productCats = productCategories.data?.items ?? []

  const activeChips: Array<{ key: string; label: string; clear: () => void }> = []
  if (filters.q) activeChips.push({ key: 'q', label: `«${filters.q}»`, clear: () => patch({ q: '' }) })
  if (filters.favorites) activeChips.push({ key: 'fav', label: 'Избранное', clear: () => patch({ favorites: false }) })
  if (filters.sort === 'new') activeChips.push({ key: 'new', label: 'Новое', clear: () => patch({ sort: '' }) })
  if (filters.sort === 'recommended') activeChips.push({ key: 'rec', label: 'Рекомендовано', clear: () => patch({ sort: '' }) })
  for (const c of filters.category) {
    activeChips.push({ key: `c-${c}`, label: c, clear: () => patch({ category: filters.category.filter((x) => x !== c) }) })
  }
  for (const b of filters.brand) {
    activeChips.push({ key: `b-${b}`, label: b, clear: () => patch({ brand: filters.brand.filter((x) => x !== b) }) })
  }
  for (const s of filters.supplier) {
    const label = suppliers.find((x) => x.value === s)?.label ?? 'Поставщик'
    activeChips.push({ key: `s-${s}`, label, clear: () => patch({ supplier: filters.supplier.filter((x) => x !== s) }) })
  }
  for (const p of filters.product_id) {
    const opt = productOpts.find((x) => x.id === p)
    activeChips.push({ key: `p-${p}`, label: opt ? [opt.brand, opt.name].filter(Boolean).join(' · ') : 'Товар', clear: () => patch({ product_id: filters.product_id.filter((x) => x !== p) }) })
  }
  for (const c of filters.product_category_id) {
    const name = productCats.find((x) => x.id === c)?.name ?? 'Категория'
    activeChips.push({ key: `pc-${c}`, label: name, clear: () => patch({ product_category_id: filters.product_category_id.filter((x) => x !== c) }) })
  }

  async function loadMore() {
    const res = await apiRequest<KnowledgeListResponse>(
      `/v1/knowledge${knowledgeApiQuery(filters, { limit: PAGE_SIZE, offset })}`,
      { token },
    )
    setExtra((prev) => [...prev, ...(res.items ?? [])])
    setOffset((n) => n + PAGE_SIZE)
  }

  const quickChips: Array<{ id: string; label: string; active: boolean; tone?: string; onClick: () => void }> = [
    { id: 'fav', label: 'Избранное', active: filters.favorites, onClick: () => patch({ favorites: !filters.favorites, sort: '' }) },
    { id: 'new', label: 'Новое', active: filters.sort === 'new', onClick: () => patch({ sort: filters.sort === 'new' ? '' : 'new', favorites: false }) },
    { id: 'rec', label: 'Рекомендовано', active: filters.sort === 'recommended', onClick: () => patch({ sort: filters.sort === 'recommended' ? '' : 'recommended', favorites: false }) },
    ...cats.filter((c) => !c.value.includes(' / ')).map((c) => ({
      id: `cat-${c.value}`,
      label: c.label,
      tone: knowledgeSectionToneClass(c.value),
      active: filters.category.includes(c.value),
      onClick: () => {
        const next = filters.category.includes(c.value)
          ? filters.category.filter((x) => x !== c.value)
          : [...filters.category, c.value]
        patch({ category: next })
      },
    })),
  ]

  return (
    <main className="page stack kb-hub">
      <section className="kb-hero card stack">
        <p className="eyebrow">Salon-X</p>
        <h1>База знаний</h1>
        <p className="muted">
          {professional
            ? 'Материалы для салона и домашнего ухода: технологии, инструкции и рекомендации поставщиков.'
            : 'Рекомендации по домашнему уходу и косметика, которую можно использовать дома.'}
        </p>
        <div className="kb-search-bar">
          <div className="field">
            <label htmlFor="kb-search">Поиск по названию</label>
            <div className="kb-search-input-wrap">
              <input
                id="kb-search"
                data-testid="kb-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по базе знаний"
                autoComplete="off"
                enterKeyHint="search"
              />
              {search ? (
                <button
                  className="btn btn-ghost btn-compact kb-search-clear"
                  type="button"
                  aria-label="Очистить поиск"
                  onClick={() => { setSearch(''); patch({ q: '' }) }}
                >
                  ×
                </button>
              ) : null}
            </div>
          </div>
          <div className="kb-search-meta">
            <p className="kb-result-count" aria-live="polite">
              {!list.isLoading && filters.q
                ? `Найдено: ${total}`
                : !list.isLoading
                  ? `${total} материалов`
                  : 'Поиск…'}
            </p>
            <button className="btn btn-secondary" type="button" onClick={() => setDrawer(true)}>
              Фильтры{filtersActive(filters) ? ' · выбраны' : ''}
            </button>
          </div>
        </div>
        <div className="chip-row kb-quick-chips">
          {quickChips.map((c) => (
            <button key={c.id} type="button" className={`chip ${c.tone ?? ''} ${c.active ? 'active' : ''}`} onClick={c.onClick}>
              {c.label}
            </button>
          ))}
        </div>
        {activeChips.length > 0 && (
          <div className="row kb-active-filters">
            {activeChips.map((c) => (
              <button key={c.key} type="button" className="chip active" onClick={c.clear}>{c.label} ×</button>
            ))}
            <button className="btn btn-ghost btn-compact" type="button" onClick={() => { setSearch(''); setFilters(emptyFilters()) }}>
              Сбросить всё
            </button>
          </div>
        )}
      </section>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Фильтры" label="Фильтры базы знаний">
          <div className="stack kb-filter-panel">
          <SearchableMultiSelect
            id="kb-f-supplier"
            label="Поставщик"
            options={suppliers.map((s) => ({ value: s.value, label: s.label }))}
            values={filters.supplier}
            onChange={(supplier) => patch({ supplier })}
            placeholder="Найти поставщика"
          />
          <SearchableMultiSelect
            id="kb-f-brand"
            label="Бренд"
            options={brands.map((s) => ({ value: s.value, label: s.label }))}
            values={filters.brand}
            onChange={(brand) => patch({ brand })}
            placeholder="Найти бренд"
          />
          <SearchableMultiSelect
            id="kb-f-pcat"
            label="Категория товара"
            options={productCats.map((s) => ({ value: s.id, label: s.name }))}
            values={filters.product_category_id}
            onChange={(product_category_id) => patch({ product_category_id })}
            placeholder="Категория каталога"
          />
          <SearchableMultiSelect
            id="kb-f-acat"
            label="Категория материала"
            options={cats.map((s) => ({ value: s.value, label: s.label }))}
            values={filters.category}
            onChange={(category) => patch({ category })}
            placeholder="Колористика, уход…"
          />
          <div className="field kb-multiselect">
            <label htmlFor="kb-f-product">Товар</label>
            {filters.product_id.length > 0 && (
              <div className="chip-row">
                {filters.product_id.map((id) => {
                  const opt = productOpts.find((p) => p.id === id)
                  return (
                    <button key={id} type="button" className="chip active" onClick={() => patch({ product_id: filters.product_id.filter((x) => x !== id) })}>
                      {opt ? [opt.brand, opt.name].filter(Boolean).join(' · ') : 'Товар'} ×
                    </button>
                  )
                })}
              </div>
            )}
            <input
              id="kb-f-product"
              value={productQ}
              onChange={(e) => setProductQ(e.target.value)}
              placeholder="Название или бренд товара"
              autoComplete="off"
            />
            {(productSearch.data?.items ?? []).filter((p) => !filters.product_id.includes(p.id)).slice(0, 8).map((p) => (
              <button
                key={p.id}
                type="button"
                className="kb-suggest-btn"
                onClick={() => {
                  setProductOpts((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]))
                  patch({ product_id: [...filters.product_id, p.id] })
                  setProductQ('')
                }}
              >
                {[p.brand, p.name].filter(Boolean).join(' · ')}
              </button>
            ))}
          </div>
          <div className="row wrap">
            <button className="btn btn-secondary" type="button" onClick={() => { setSearch(''); setFilters(emptyFilters()) }}>
              Сбросить
            </button>
            <button className="btn btn-primary" type="button" onClick={() => setDrawer(false)}>
              Применить
            </button>
          </div>
          </div>
        </Drawer>

      {list.isLoading && (
        <div className="kb-grid" aria-busy="true" aria-label="Загрузка материалов">
          <KnowledgeCardSkeleton />
          <KnowledgeCardSkeleton />
          <KnowledgeCardSkeleton />
        </div>
      )}
      {list.isError && <ErrorBanner error={list.error} fallbackTitle="Не удалось загрузить базу знаний" />}

      {brands.length > 0 && (browseHome || epicaSelected) && (
        <section className="stack kb-section">
          <h2>Бренды</h2>
          <div className="kb-brand-row">
            {brands.map((brand) => (
              <button
                key={brand.value}
                type="button"
                className={`card kb-brand-card ${filters.brand.includes(brand.value) ? 'selected' : ''}`}
                onClick={() => patch({ brand: filters.brand.includes(brand.value) ? [] : [brand.value], category: [] })}
              >
                <strong>{brand.label}</strong>
                <span className="muted">{brand.count} материалов</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {catalogTree.length > 0 && (browseHome || epicaSelected || filters.category.length > 0) && (
        <CatalogTreeAccordion
          nodes={catalogTree}
          selected={selectedCategory}
          onClear={() => patch({ category: [] })}
          onSelect={(path) => patch({
            category: selectedCategory === path ? [] : [path],
            brand: epicaSelected || !browseHome ? filters.brand : ['EPICA Professional'],
          })}
        />
      )}

      {epicaSelected && (
        <div className="chip-row">
          {EPICA_SERIES.map((series) => (
            <button
              key={series}
              type="button"
              className={`chip ${filters.q.toUpperCase() === series ? 'active' : ''}`}
              onClick={() => patch({ q: filters.q.toUpperCase() === series ? '' : series })}
            >
              {series}
            </button>
          ))}
        </div>
      )}

      {browseHome && (recommended.data?.items?.length ?? 0) > 0 && (
        <section className="stack kb-section">
          <h2>Рекомендовано для вас</h2>
          <p className="muted">Подобрано по связанным товарам, бренду и актуальности материалов</p>
          <div className="kb-grid">
            {recommended.data!.items.map((a) => (
              <KnowledgeCard key={a.id} article={a} token={token} showAudience={professional} onFavorite={(x) => fav.mutate(x)} favoritePending={fav.isPending} />
            ))}
          </div>
        </section>
      )}

      {browseHome && (favoritesSec.data?.items?.length ?? 0) > 0 && (
        <section className="stack kb-section">
          <h2>Избранное</h2>
          <div className="kb-grid">
            {favoritesSec.data!.items.map((a) => (
              <KnowledgeCard key={a.id} article={a} token={token} showAudience={professional} onFavorite={(x) => fav.mutate(x)} favoritePending={fav.isPending} />
            ))}
          </div>
        </section>
      )}

      {browseHome && (newest.data?.items?.length ?? 0) > 0 && (
        <section className="stack kb-section">
          <h2>Новое</h2>
          <div className="kb-grid">
            {newest.data!.items.map((a) => (
              <KnowledgeCard key={a.id} article={a} token={token} showAudience={professional} onFavorite={(x) => fav.mutate(x)} favoritePending={fav.isPending} />
            ))}
          </div>
        </section>
      )}

      <section className="stack kb-section">
        <h2>{browseHome ? 'Все материалы' : 'Результаты'}</h2>
        {!list.isLoading && items.length === 0 && (
          <EmptyState
            title={knowledgeEmptyTitle(professional, filtersActive(filters))}
            text={
              filtersActive(filters)
                ? 'Снимите один из фильтров или сбросьте все условия поиска.'
                : professional
                  ? 'Попробуйте изменить поиск или сбросить фильтры.'
                  : 'Когда поставщики опубликуют рекомендации по домашней косметике, они появятся здесь.'
            }
            action={
              filtersActive(filters) ? (
                <button className="btn btn-secondary" type="button" onClick={() => { setSearch(''); setFilters(emptyFilters()) }}>
                  {filters.q ? 'Очистить поиск' : 'Сбросить фильтры'}
                </button>
              ) : undefined
            }
          />
        )}
        <div className="kb-grid">
          {items.map((a) => (
            <KnowledgeCard key={a.id} article={a} token={token} showAudience={professional} onFavorite={(x) => fav.mutate(x)} favoritePending={fav.isPending} />
          ))}
        </div>
        {hasMore && (
          <button className="btn btn-secondary" type="button" onClick={() => void loadMore()}>Показать ещё</button>
        )}
      </section>
    </main>
  )
}

function SupplierKnowledgeHome() {
  const { accessToken } = useAuth()
  const [params, setParams] = useSearchParams()
  const qParam = params.get('q') ?? ''
  const [search, setSearch] = useState(qParam)
  const [extra, setExtra] = useState<KnowledgeArticle[]>([])

  useEffect(() => { setSearch(qParam) }, [qParam])
  useEffect(() => {
    const next = search.trim()
    if (next === qParam) return
    const t = window.setTimeout(() => {
      const p = new URLSearchParams(params)
      if (next) p.set('q', next)
      else p.delete('q')
      setParams(p, { replace: true })
    }, 300)
    return () => window.clearTimeout(t)
  }, [search, qParam, params, setParams])

  useEffect(() => {
    setExtra([])
  }, [qParam])

  const mine = useQuery({
    queryKey: ['knowledge-mine', qParam],
    queryFn: () => {
      const qs = new URLSearchParams({ limit: '50' })
      if (qParam.trim()) qs.set('q', qParam.trim())
      return apiRequest<KnowledgeListResponse>(`/v1/me/knowledge?${qs}`, { token: accessToken })
    },
    enabled: Boolean(accessToken),
    placeholderData: keepPreviousData,
  })
  const items = [...(mine.data?.items ?? []), ...extra]
  const total = mine.data?.total ?? items.length

  return (
    <main className="page stack">
      <div className="row between wrap">
        <div className="stack-sm">
          <h1>База знаний</h1>
          <p className="muted">Материалы для мастеров: черновики, публикация и связи с товарами.</p>
        </div>
        <Link className="btn btn-primary" to="/knowledge/new">Создать материал</Link>
      </div>
      <div className="kb-search-bar card stack-sm">
        <div className="field">
          <label htmlFor="kb-mine-search">Поиск по названию</label>
          <div className="kb-search-input-wrap">
            <input
              id="kb-mine-search"
              data-testid="kb-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по базе знаний"
              autoComplete="off"
              enterKeyHint="search"
            />
            {search ? (
              <button
                className="btn btn-ghost btn-compact kb-search-clear"
                type="button"
                aria-label="Очистить поиск"
                onClick={() => {
                  setSearch('')
                  const p = new URLSearchParams(params)
                  p.delete('q')
                  setParams(p, { replace: true })
                }}
              >
                ×
              </button>
            ) : null}
          </div>
        </div>
        <p className="kb-result-count" aria-live="polite">
          {!mine.isLoading ? (qParam ? `Найдено: ${total}` : `${total} материалов`) : 'Поиск…'}
        </p>
      </div>
      {mine.isLoading && <div className="kb-grid" aria-busy="true"><KnowledgeCardSkeleton /><KnowledgeCardSkeleton /></div>}
      {mine.isError && <ErrorBanner error={mine.error} fallbackTitle="Не удалось загрузить материалы" />}
      {!mine.isLoading && items.length === 0 && (
        <EmptyState
          title={qParam ? 'Ничего не найдено' : 'Статей пока нет'}
          text={qParam ? 'Измените запрос или очистите поиск.' : 'Создайте инструкцию или технологию и свяжите её со своими товарами.'}
          action={qParam ? undefined : <Link className="btn btn-primary" to="/knowledge/new">Создать материал</Link>}
        />
      )}
      <div className="kb-grid">
        {items.map((a) => (
          <KnowledgeCard
            key={a.id}
            article={a}
            token={accessToken}
            showAudience
            actions={
              <div className="row wrap">
                <span className={`badge ${statusBadgeClass(a.status || (a.published ? 'published' : 'draft'))}`}>
                  {productStateLabel(a.status || (a.published ? 'published' : 'draft'))}
                </span>
                <Link className="btn btn-secondary" to={`/knowledge/${a.id}/edit`}>Редактировать</Link>
                <Link className="btn btn-ghost" to={`/knowledge/${a.id}`}>Предпросмотр</Link>
              </div>
            }
          />
        ))}
      </div>
      {items.length < total && (
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => {
            const qs = new URLSearchParams({ limit: '50', offset: String(items.length) })
            if (qParam.trim()) qs.set('q', qParam.trim())
            void apiRequest<KnowledgeListResponse>(`/v1/me/knowledge?${qs}`, { token: accessToken })
              .then((res) => setExtra((prev) => [...prev, ...(res.items ?? [])]))
          }}
        >
          Показать ещё
        </button>
      )}
    </main>
  )
}
