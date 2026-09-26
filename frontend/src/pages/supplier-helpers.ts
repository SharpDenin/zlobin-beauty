export function supplierPhotoClearValue(mediaId: string | null, isNew: boolean) {
  if (mediaId) return mediaId
  return isNew ? null : ''
}

export type SupplierProductWriteInput = {
  name: string
  brand?: string
  description?: string
  price_rubles: number
  volume_label?: string
  unit: string
  sku?: string
  delivery_days: number
  for_sale: boolean
  published: boolean
  audience: 'all' | 'professional_only'
  category_id?: string
}

export function supplierProductWriteBody(opts: {
  isNew: boolean
  organizationId?: string
  values: SupplierProductWriteInput
  photoMediaId: string | null
}) {
  const { values } = opts
  const body: Record<string, unknown> = {
    name: values.name.trim(),
    brand: values.brand ?? '',
    description: values.description ?? '',
    price_minor: Math.round(values.price_rubles * 100),
    volume_label: values.volume_label ?? '',
    unit: values.unit,
    sku: values.sku ?? '',
    delivery_days: values.delivery_days,
    for_sale: values.for_sale,
    published: values.published,
    audience: values.audience,
    photo_media_id: supplierPhotoClearValue(opts.photoMediaId, opts.isNew),
  }
  if (opts.isNew) {
    body.organization_id = opts.organizationId
    body.min_stock = 0
  }
  if (values.category_id) body.category_id = values.category_id
  return body
}

export function supplierCatalogQuery(q: string, audience: string, category: string) {
  return {
    q: q.trim().toLowerCase(),
    audience,
    category,
  }
}

export function supplierProductMatches(
  product: { name: string; brand?: string; sku?: string; category?: string; category_id?: string | null; audience?: string },
  filters: { q: string; audience: string; category: string },
) {
  if (filters.audience && (product.audience || 'all') !== filters.audience) return false
  if (filters.category && (product.category_id || product.category || '') !== filters.category) return false
  if (!filters.q) return true
  const hay = [product.brand, product.name, product.sku, product.category].filter(Boolean).join(' ').toLowerCase()
  return hay.includes(filters.q)
}

export function supplierHasActiveFilters(q: string, audience: string, category: string) {
  return Boolean(q.trim() || audience || category)
}

export function supplierOrderIsTerminal(status: string) {
  return status === 'cancelled' || status.startsWith('cancelled') || status === 'delivered' || status === 'received'
}
