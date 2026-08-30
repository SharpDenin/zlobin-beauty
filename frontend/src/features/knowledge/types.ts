export type KnowledgeArticle = {
  id: string
  title: string
  category: string
  content?: string
  excerpt?: string
  content_format?: string
  cover_media_id?: string | null
  reading_time_minutes?: number
  brand?: string
  author_name: string
  author_org_id?: string | null
  product_id?: string | null
  product_ids?: string[]
  category_ids?: string[]
  view_count?: number
  favorite?: boolean
  published?: boolean
  status?: string
  published_at?: string | null
  created_at: string
  home_care?: boolean
  professional?: boolean
  audience_kind?: 'home' | 'professional' | 'mixed'
}

export type KnowledgeFacet = { value: string; label: string; count: number }

export type KnowledgeFilters = {
  q: string
  category: string[]
  brand: string[]
  supplier: string[]
  product_id: string[]
  product_category_id: string[]
  favorites: boolean
  sort: string
}

export const emptyFilters = (): KnowledgeFilters => ({
  q: '',
  category: [],
  brand: [],
  supplier: [],
  product_id: [],
  product_category_id: [],
  favorites: false,
  sort: '',
})

export function filtersFromSearch(params: URLSearchParams): KnowledgeFilters {
  return {
    q: params.get('q') ?? '',
    category: params.getAll('category'),
    brand: params.getAll('brand'),
    supplier: params.getAll('supplier'),
    product_id: params.getAll('product_id'),
    product_category_id: params.getAll('product_category_id'),
    favorites: params.get('favorites') === '1',
    sort: params.get('sort') ?? '',
  }
}

export function filtersToSearch(f: KnowledgeFilters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.q.trim()) p.set('q', f.q.trim())
  for (const v of f.category) p.append('category', v)
  for (const v of f.brand) p.append('brand', v)
  for (const v of f.supplier) p.append('supplier', v)
  for (const v of f.product_id) p.append('product_id', v)
  for (const v of f.product_category_id) p.append('product_category_id', v)
  if (f.favorites) p.set('favorites', '1')
  if (f.sort) p.set('sort', f.sort)
  return p
}

export function filtersActive(f: KnowledgeFilters): boolean {
  return Boolean(
    f.q || f.favorites || f.sort ||
    f.category.length || f.brand.length || f.supplier.length ||
    f.product_id.length || f.product_category_id.length,
  )
}

export function knowledgeListPath(f: KnowledgeFilters): string {
  const qs = filtersToSearch(f).toString()
  return qs ? `/knowledge?${qs}` : '/knowledge'
}

export function knowledgeApiQuery(f: KnowledgeFilters, extra?: { limit?: number; offset?: number; sort?: string }): string {
  const p = filtersToSearch(f)
  if (extra?.sort) p.set('sort', extra.sort)
  if (extra?.limit) p.set('limit', String(extra.limit))
  if (extra?.offset) p.set('offset', String(extra.offset))
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

export type KnowledgeListResponse = {
  items: KnowledgeArticle[]
  total: number
  limit: number
  offset: number
}
