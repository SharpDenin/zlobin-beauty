export const WORK_MODE_LABELS: Record<string, string> = {
  percentage: 'На процентах',
  chair: 'В салоне',
  onsite: 'Выезд',
}

export function workModeLabel(mode?: string | null) {
  if (!mode) return ''
  return WORK_MODE_LABELS[mode] || mode
}

export type GeoCity = { id: string; name: string; timezone: string }
export type GeoDistrict = { id: string; city_id: string; name: string }

export type WorkModeInterval = {
  id: string
  mode: string
  mode_label: string
  starts_at: string
  ends_at: string
  timezone: string
  chair_id?: string | null
  city_id?: string | null
  percentage_rate?: number | null
  location_label?: string
  districts?: GeoDistrict[]
  chair?: { id: string; name: string } | null
  city?: GeoCity | null
}

export type SalonChair = {
  id: string
  organization_id: string
  branch_id: string
  name: string
  description: string
  status: string
  listed_for_rent: boolean
  rent_note: string
}

export type ChairLease = {
  id: string
  chair_id: string
  organization_id: string
  renter_user_id: string
  starts_at: string
  ends_at: string
  status: string
  chair?: SalonChair | null
}

export const LEASE_LABELS: Record<string, string> = {
  requested: 'Запрошена',
  active: 'Активна',
  rejected: 'Отклонена',
  cancelled: 'Отменена',
  expired: 'Истекла',
}
