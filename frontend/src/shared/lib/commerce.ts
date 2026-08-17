import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'

export type BranchCard = {
  id: string
  organization_id?: string
  name: string
  city: string
  address_line: string
  phone: string
  timezone?: string
  published?: boolean
  pickup_enabled?: boolean
  latitude?: number | null
  longitude?: number | null
  distance_km?: number | null
}

export type OrgItem = {
  organization: {
    id: string
    name: string
    type: string
    published?: boolean
    description?: string
    delivery_note?: string
    masters_see_client_contacts?: boolean
  }
  branches: BranchCard[]
  roles: string[]
}

export type Location = { id: string; name: string; kind: string }

export type CommerceProduct = {
  id: string
  organization_id: string
  brand: string
  name: string
  sku?: string
  description?: string
  unit: string
  volume_label: string
  price_minor: number
  min_stock?: number
  published: boolean
  for_sale?: boolean
  delivery_days?: number
  photo_media_id?: string | null
  category?: string
  category_id?: string | null
  available?: boolean
}

export type SupplierCard = {
  id: string
  name: string
  city?: string
  description?: string
  delivery_note?: string
  /** Optional marketing hint; backend may send product_count instead. */
  product_hint?: string
  products_count?: number
  product_count?: number
}

export type OrderDelivery = {
  id: string
  order_id: string
  status: string
  planned_delivery_at?: string | null
  window_start?: string | null
  window_end?: string | null
  destination_branch_id?: string
  recipient_name?: string
  recipient_phone?: string
  comment?: string
  provider?: string
  tracking_code?: string
}

export type SupplierOrder = {
  id: string
  status: string
  total_minor: number
  subtotal_minor?: number
  delivery_cost_minor?: number
  payment_method?: string
  payment_status?: string
  destination_branch_id?: string | null
  supplier_org_id?: string
  buyer_org_id?: string
  estimated_delivery_at?: string | null
  paid_at?: string | null
  created_at: string
  comment?: string
  items?: Array<{ product_id: string; qty_ordered: number; price_minor: number; product_name?: string }>
}

export const PAYMENT_METHOD_OPTIONS = [
  { value: 'cash', label: 'Наличные' },
  { value: 'bank_transfer', label: 'Банковский перевод' },
  { value: 'card', label: 'Карта' },
  { value: 'invoice', label: 'Счёт / безнал' },
] as const

export function paymentMethodLabel(method?: string | null) {
  if (!method) return '—'
  return PAYMENT_METHOD_OPTIONS.find((o) => o.value === method)?.label ?? method
}

export function useMyOrgs() {
  const { accessToken } = useAuth()
  return useQuery({
    queryKey: ['orgs-mine'],
    queryFn: () => apiRequest<{ items: OrgItem[] }>('/v1/organizations/mine', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
}

export function useBuyerOrg() {
  const orgs = useMyOrgs()
  const buyerOrg = (orgs.data?.items ?? []).find((i) => i.organization.type !== 'supplier')
    ?? orgs.data?.items[0]
  return { orgs, buyerOrg, buyerOrgId: buyerOrg?.organization.id }
}

export function useSupplierOrg() {
  const orgs = useMyOrgs()
  const supplierOrgs = (orgs.data?.items ?? []).filter((i) => i.organization.type === 'supplier')
  const supplierOrg = supplierOrgs[0]
  return { orgs, supplierOrgs, supplierOrg, supplierOrgId: supplierOrg?.organization.id }
}

export async function fetchSuppliers(token: string | null): Promise<SupplierCard[]> {
  try {
    const res = await apiRequest<{ items: SupplierCard[] }>('/v1/suppliers', { token })
    return res.items ?? []
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 501)) return []
    throw e
  }
}

export async function fetchSupplier(token: string | null, id: string): Promise<SupplierCard | null> {
  try {
    return await apiRequest<SupplierCard>(`/v1/suppliers/${id}`, { token })
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null
    throw e
  }
}

export async function fetchPickupBranches(
  token: string | null,
  buyerOrgId?: string,
  fallbackBranches?: BranchCard[],
  coords?: { lat: number; lng: number } | null,
): Promise<BranchCard[]> {
  const fromMine = () =>
    (fallbackBranches ?? []).filter((b) => b.published !== false && b.pickup_enabled === true)

  try {
    const res = await apiRequest<{ items: BranchCard[] }>(
      coords ? `/v1/branches/pickup?lat=${coords.lat}&lng=${coords.lng}&nearest=1` : '/v1/branches/pickup',
      { token },
    )
    let items = res.items ?? []
    if (buyerOrgId) {
      const own = items.filter((b) => b.organization_id === buyerOrgId)
      if (own.length > 0) return own
    }
    if (items.length > 0) return items
  } catch (e) {
    if (!(e instanceof ApiError && (e.status === 404 || e.status === 501))) {
      // Prefer fallback for soft failures when endpoint missing.
      if (!(e instanceof ApiError)) throw e
    }
  }
  return fromMine()
}

export async function fetchBranch(token: string | null, id: string): Promise<BranchCard | null> {
  try {
    return await apiRequest<BranchCard>(`/v1/branches/${id}`, { token })
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null
    throw e
  }
}

export function useEnsureLocation(buyerOrgId?: string) {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const locations = useQuery({
    queryKey: ['commerce-locations', buyerOrgId],
    queryFn: () =>
      apiRequest<{ items: Location[] }>(`/v1/commerce/locations?organization_id=${buyerOrgId}`, {
        token: accessToken,
      }),
    enabled: Boolean(accessToken && buyerOrgId),
  })

  const ensure = useMutation({
    mutationFn: async () => {
      if (!buyerOrgId) throw new ApiError('Сначала создайте салон', 'validation_error', 400)
      return apiRequest<{ id?: string }>('/v1/commerce/locations', {
        token: accessToken,
        body: { organization_id: buyerOrgId, name: 'Основной склад', kind: 'salon' },
      })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['commerce-locations'] })
    },
  })

  return { locations, ensure, locationId: locations.data?.items[0]?.id }
}

export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
