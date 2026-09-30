export type PortfolioMediaType = 'photo' | 'gif' | 'video'

export type PortfolioItem = {
  id: string
  master_id: string
  media_id: string
  caption: string
  title: string
  description: string
  category: string
  media_type: PortfolioMediaType | string
  sort_order: number
  created_at: string
  updated_at?: string
}

export type PortfolioListResponse = { items: PortfolioItem[] }

export function portfolioDisplayTitle(item: Pick<PortfolioItem, 'title' | 'caption'>): string {
  const title = item.title?.trim()
  if (title) return title
  return item.caption?.trim() || ''
}

export function collectPortfolioCategories(items: PortfolioItem[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const c = item.category?.trim()
    if (!c || seen.has(c)) continue
    seen.add(c)
    out.push(c)
  }
  return out.sort((a, b) => a.localeCompare(b, 'ru'))
}

export function filterPortfolioByCategory(items: PortfolioItem[], category: string): PortfolioItem[] {
  if (!category || category === 'Все') return items
  return items.filter((i) => i.category.trim() === category)
}

export function movePortfolioItem(ids: string[], id: string, direction: 'up' | 'down'): string[] {
  const idx = ids.indexOf(id)
  if (idx < 0) return ids
  const target = direction === 'up' ? idx - 1 : idx + 1
  if (target < 0 || target >= ids.length) return ids
  const next = [...ids]
  ;[next[idx], next[target]] = [next[target], next[idx]]
  return next
}

export function suggestPortfolioCategories(
  serviceCategories: string[],
  professionNames: string[],
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [...serviceCategories, ...professionNames]) {
    const c = raw.trim()
    if (!c || seen.has(c)) continue
    seen.add(c)
    out.push(c)
  }
  return out.slice(0, 12)
}
