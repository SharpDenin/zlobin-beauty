export type VisitService = {
  id: string
  name: string
  category?: string
  duration_minutes: number
  price_minor: number
  price_display?: string
  booking_mode?: string
  organization_id?: string
  photo_media_id?: string | null
}

export type VisitLeg = {
  service_id: string
  service_name: string
  master_id: string
  master_user_id: string
  master_display_name: string
  starts_at: string
  ends_at: string
  duration_minutes: number
  price_minor: number
  currency?: string
  work_mode?: string
}

export type VisitPlan = {
  starts_at: string
  ends_at: string
  wait_minutes: number
  total_minutes: number
  same_master: boolean
  reason?: string
  legs: VisitLeg[]
}

export type VisitPlansResponse = {
  timezone: string
  total_price_minor: number
  currency?: string
  recommended_order: string[]
  order_warning?: string
  horizon_days: number
  items: VisitPlan[]
}

export type ListedAppointment = {
  id: string
  service_name: string
  status: string
  starts_at: string
  ends_at?: string
  price_minor: number
  visit_group_id?: string | null
  master_user_id?: string
  client_user_id?: string
  client_display_name?: string
  master_display_name?: string
}

export type VisitGroup = {
  key: string
  combined: boolean
  items: ListedAppointment[]
}

export function canJoinMultiService(service?: { booking_mode?: string } | null) {
  return Boolean(service) && service?.booking_mode !== 'fixed_window'
}

export function salonCompanionServices(items: VisitService[], selectedId: string) {
  return items.filter(
    (item) => item.id !== selectedId && item.booking_mode !== 'fixed_window',
  )
}

export function formatVisitMinutes(total: number) {
  if (!Number.isFinite(total) || total <= 0) return '0 мин'
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours <= 0) return `${minutes} мин`
  if (minutes === 0) return `${hours} ч`
  return `${hours} ч ${minutes} мин`
}

export function visitPlanKey(plan: VisitPlan) {
  return plan.legs.map((leg) => `${leg.master_id}:${leg.starts_at}`).join('|')
}

export function confirmLegsFromPlan(plan: VisitPlan) {
  return plan.legs.map((leg) => ({
    service_id: leg.service_id,
    master_id: leg.master_id,
    starts_at: leg.starts_at,
  }))
}

export function swapServiceOrder(order: string[]) {
  if (order.length !== 2) return order.slice()
  return [order[1], order[0]]
}

export function groupAppointmentsByVisit(items: ListedAppointment[]): VisitGroup[] {
  const groups = new Map<string, ListedAppointment[]>()
  for (const item of items) {
    const gid = item.visit_group_id?.trim()
    if (!gid) continue
    const list = groups.get(gid) ?? []
    list.push(item)
    groups.set(gid, list)
  }
  const seen = new Set<string>()
  const out: VisitGroup[] = []
  for (const item of items) {
    const gid = item.visit_group_id?.trim()
    if (gid) {
      if (seen.has(gid)) continue
      seen.add(gid)
      const members = (groups.get(gid) ?? [item]).slice().sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      out.push({ key: gid, combined: members.length > 1, items: members })
      continue
    }
    out.push({ key: item.id, combined: false, items: [item] })
  }
  return out
}

export function visitGroupTitle(group: VisitGroup) {
  return group.items.map((item) => item.service_name).join(' + ')
}

export function visitGroupPrice(group: VisitGroup) {
  return group.items.reduce((sum, item) => sum + (item.price_minor || 0), 0)
}

export function isVisitPlanRace(code?: string) {
  return code === 'appointment_time_conflict' || code === 'appointment_concurrent_update'
}
