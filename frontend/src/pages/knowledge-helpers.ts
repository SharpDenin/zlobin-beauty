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
