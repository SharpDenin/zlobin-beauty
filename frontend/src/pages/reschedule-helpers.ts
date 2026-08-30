import { formatLocalInTimezone } from '@/shared/lib/time'

export type RescheduleSlot = {
  starts_at: string
  ends_at: string
  work_mode?: string
}

export type RescheduleOptionsResponse = {
  timezone: string
  horizon_days: number
  has_more: boolean
  master_display_name?: string
  appointment?: {
    id: string
    service_name: string
    starts_at: string
    ends_at: string
    location_name?: string
    location_city?: string
    location_timezone?: string
    booking_mode?: string
    status?: string
    master_user_id?: string
  }
  items: RescheduleSlot[]
}

export type SlotDateGroup = {
  dateKey: string
  label: string
  slots: RescheduleSlot[]
}

export function canRescheduleAppointment(status?: string, bookingMode?: string) {
  if (bookingMode === 'fixed_window') return false
  return status === 'pending_confirmation' || status === 'confirmed'
}

function ymdInTimezone(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso))
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

function addCalendarDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString()
}

export function slotDateLabel(iso: string, timeZone: string, now = new Date()): string {
  const key = ymdInTimezone(iso, timeZone)
  const today = ymdInTimezone(now.toISOString(), timeZone)
  const tomorrow = ymdInTimezone(addCalendarDays(now.toISOString(), 1), timeZone)
  if (key === today) return 'Сегодня'
  if (key === tomorrow) return 'Завтра'
  return formatLocalInTimezone(iso, timeZone, { day: 'numeric', month: 'long' })
}

export function slotTimeLabel(iso: string, timeZone: string): string {
  return formatLocalInTimezone(iso, timeZone, { hour: '2-digit', minute: '2-digit' })
}

export function slotDateTimeLabel(iso: string, timeZone: string): string {
  return formatLocalInTimezone(iso, timeZone, {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function groupSlotsByDate(items: RescheduleSlot[], timeZone: string, now = new Date()): SlotDateGroup[] {
  const groups: SlotDateGroup[] = []
  const index = new Map<string, SlotDateGroup>()
  for (const slot of items) {
    const dateKey = ymdInTimezone(slot.starts_at, timeZone)
    let group = index.get(dateKey)
    if (!group) {
      group = { dateKey, label: slotDateLabel(slot.starts_at, timeZone, now), slots: [] }
      index.set(dateKey, group)
      groups.push(group)
    }
    group.slots.push(slot)
  }
  return groups
}

export function isRaceSlotError(code?: string) {
  return code === 'appointment_time_conflict' || code === 'appointment_concurrent_update'
}
