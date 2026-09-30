import type { JSONContent } from '@tiptap/react'

export type KnowledgeRecommendation = {
  id: string
  article_id?: string
  title: string
  excerpt?: string
  category?: string
  context?: string
  product_ids?: string[]
}

export type KnowledgeRecommendResponse = {
  items: KnowledgeRecommendation[]
  empty_reason?: string
  service_id?: string
}

export function knowledgeProductPath(productId: string) {
  return `/knowledge?product_id=${encodeURIComponent(productId)}`
}

export function knowledgeServiceQuery(opts: {
  serviceId?: string
  organizationId?: string
  appointmentId?: string
  productIds?: string[]
  q?: string
}) {
  const p = new URLSearchParams()
  if (opts.serviceId) p.set('service_id', opts.serviceId)
  if (opts.organizationId) p.set('organization_id', opts.organizationId)
  if (opts.appointmentId) p.set('appointment_id', opts.appointmentId)
  if (opts.q?.trim()) p.set('q', opts.q.trim())
  for (const id of opts.productIds ?? []) {
    if (id) p.append('product_id', id)
  }
  const qs = p.toString()
  return qs ? `/v1/me/knowledge/recommendations?${qs}` : '/v1/me/knowledge/recommendations'
}

export function recommendationContextLabel(context?: string) {
  switch (context) {
    case 'product':
      return 'По продукту'
    case 'service':
      return 'По услуге'
    case 'search':
      return 'Поиск'
    default:
      return 'База знаний'
  }
}

export function emptyRecommendationMessage(reason?: string, kind: 'product' | 'service' | 'generic' = 'generic') {
  if (reason?.trim()) return reason.trim()
  if (kind === 'product') return 'Сохранённых материалов по этому продукту пока нет.'
  if (kind === 'service') return 'Для этой услуги нет сохранённых материалов'
  return 'Нет сохранённых рекомендаций'
}

export function shortageKnowledgeLabel(status: string) {
  if (status === 'available') return 'Материал в наличии'
  if (status === 'incoming') return 'Материал в пути'
  if (status === 'orderable' || status === 'shortage') return 'Не хватает'
  if (status === 'unavailable') return 'Невозможно получить'
  return status
}

export function knowledgeCoverClearValue(mediaId: string | null | undefined) {
  return mediaId ?? ''
}

function asDoc(value: unknown): JSONContent | null {
  if (!value) return null
  if (Array.isArray(value)) {
    const first = value[0] as JSONContent | undefined
    if (first?.type === 'doc') return first
    return { type: 'doc', content: value as JSONContent[] }
  }
  if (typeof value !== 'object') return null
  const node = value as JSONContent
  if (node.type === 'doc') return node
  if (!node.type && Array.isArray(node.content)) {
    return { type: 'doc', content: node.content }
  }
  return null
}

export function parseKnowledgeDoc(content: unknown, format?: string | null): JSONContent {
  const direct = asDoc(content)
  if (direct) return direct
  const raw = typeof content === 'string' ? content : ''
  if ((format || 'plain') === 'doc_json' && raw) {
    try {
      const parsed = asDoc(JSON.parse(raw))
      if (parsed) return parsed
    } catch {
      /* fall through */
    }
  }
  if (!raw.trim()) {
    return { type: 'doc', content: [{ type: 'paragraph' }] }
  }
  return {
    type: 'doc',
    content: raw.split(/\n+/).map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  }
}

export function productAudienceLabel(audience?: string | null) {
  if (audience === 'professional_only') return 'Только для салонов'
  return 'Для домашнего ухода'
}

export function articleAudienceBadges(article: {
  home_care?: boolean
  professional?: boolean
  audience_kind?: string
}) {
  const kind = article.audience_kind
  if (kind === 'mixed' || (article.home_care && article.professional)) {
    return [
      { id: 'home', label: 'Для домашнего ухода' },
      { id: 'pro', label: 'Профессиональный материал' },
    ]
  }
  if (kind === 'home' || article.home_care) {
    return [{ id: 'home', label: 'Для домашнего ухода' }]
  }
  return [{ id: 'pro', label: 'Профессиональный материал' }]
}

const SERIES_NAMES = [
  'COLORSHADE',
  'COLORDREAM',
  'COLORSOLUTION',
  'OVERCOLOR',
  'OXY ACTIVE',
  'PROXY',
  'COLD BLOND PRO',
  'COLD BLOND',
  'SILVER BLOND',
  'POST COLOR',
]

export function knowledgeSeriesLabel(title: string) {
  const upper = title.toUpperCase()
  if (upper.includes('ПАЛИТРА ОТТЕНКОВ')) return ''
  for (const name of SERIES_NAMES) {
    if (upper.includes(name)) return name
  }
  return ''
}

export type KnowledgeCategoryNode = {
  name: string
  path: string
  count: number
  children: KnowledgeCategoryNode[]
}

const legacyKnowledgeCategories = new Set(['Колористика', 'Уход', 'Продукция', 'Процедуры', 'Салон', 'Бренд', 'Стайлинг'])

export function buildKnowledgeCategoryTree(facets: Array<{ value: string; count: number }>): KnowledgeCategoryNode[] {
  type Bucket = { name: string; path: string; direct: number; kids: Map<string, Bucket> }
  const root = new Map<string, Bucket>()
  for (const facet of facets) {
    if (!facet.value.includes(' / ')) {
      if (!legacyKnowledgeCategories.has(facet.value)) {
        root.set(facet.value, { name: facet.value, path: facet.value, direct: facet.count, kids: new Map() })
      }
      continue
    }
    const parts = facet.value.split(' / ').map((part) => part.trim()).filter(Boolean)
    let level = root
    let path = ''
    parts.forEach((name, index) => {
      path = path ? `${path} / ${name}` : name
      let bucket = level.get(name)
      if (!bucket) {
        bucket = { name, path, direct: 0, kids: new Map() }
        level.set(name, bucket)
      }
      if (index === parts.length - 1) bucket.direct += facet.count
      level = bucket.kids
    })
  }
  const toNodes = (map: Map<string, Bucket>): KnowledgeCategoryNode[] =>
    [...map.values()]
      .map((bucket) => {
        const children = toNodes(bucket.kids)
        return {
          name: bucket.name,
          path: bucket.path,
          count: bucket.direct + children.reduce((sum, child) => sum + child.count, 0),
          children,
        }
      })
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'))
  return toNodes(root)
}

export function knowledgeEmptyTitle(professional: boolean, filtered: boolean) {
  if (professional) return 'Материалы не найдены.'
  if (filtered) return 'По выбранным фильтрам нет материалов для домашнего ухода.'
  return 'В базе знаний пока нет материалов для домашнего ухода.'
}

export function clientVisibleProducts<T extends { audience?: string }>(items: T[], professional: boolean): T[] {
  if (professional) return items
  return items.filter((p) => p.audience !== 'professional_only')
}

export type KnowledgeSectionTone = 'primary' | 'success' | 'warning' | 'info' | 'danger' | 'neutral'

/** Stable EPICA top-level catalog sections → design-token tones. */
const EPICA_SECTION_TONES: Record<string, KnowledgeSectionTone> = {
  'Окрашивание и осветление': 'primary',
  'Уход за волосами': 'success',
  Стайлинг: 'warning',
  'Химическая завивка': 'danger',
  'Уход за кожей рук': 'info',
  'Мужское направление': 'info',
  Аксессуары: 'neutral',
  Наборы: 'warning',
  Колористика: 'primary',
  Уход: 'success',
  Продукция: 'info',
  Процедуры: 'warning',
  Салон: 'neutral',
  Бренд: 'primary',
}

const TONE_CYCLE: KnowledgeSectionTone[] = ['primary', 'success', 'warning', 'info', 'danger']

/** Top-level section label (before ` / `) → stable tone using design tokens only. */
export function knowledgeSectionTone(label: string): KnowledgeSectionTone {
  const top = (label.includes(' / ') ? label.split(' / ')[0] : label).trim()
  if (!top) return 'neutral'
  const mapped = EPICA_SECTION_TONES[top]
  if (mapped) return mapped
  let hash = 0
  for (let i = 0; i < top.length; i += 1) {
    hash = (hash * 31 + top.charCodeAt(i)) >>> 0
  }
  return TONE_CYCLE[hash % TONE_CYCLE.length]
}

export function knowledgeSectionToneClass(label: string, prefix = 'kb-tone'): string {
  return `${prefix} ${prefix}--${knowledgeSectionTone(label)}`
}
