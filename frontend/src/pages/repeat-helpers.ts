export type RepeatRequirement = {
  product_id: string
  product_name?: string
  brand?: string
  unit?: string
  required_qty: number
  available_qty: number
  incoming_qty: number
  shortage_qty: number
  status: 'available' | 'incoming' | 'shortage' | 'unavailable' | string
  expected_at?: string | null
}

export type RepeatPreview = {
  can_repeat: boolean
  availability_status?: string
  source_appointment_id: string
  service_id: string
  service: string
  date: string
  formula_hidden?: boolean
  scheme_hidden?: boolean
  hidden_reason?: string
  technique?: string
  notes?: string
  components?: Array<{ name?: string; brand?: string; qty?: string; unit?: string }>
  requirements: RepeatRequirement[]
}

export function requirementStatusLabel(status: string) {
  switch (status) {
    case 'available':
      return 'В наличии'
    case 'incoming':
      return 'Ожидается поставка'
    case 'shortage':
      return 'Не хватает'
    case 'unavailable':
      return 'Нет на складе'
    default:
      return status
  }
}

export function overallRepeatMessage(preview: RepeatPreview) {
  switch (preview.availability_status || (preview.can_repeat ? 'available' : 'shortage')) {
    case 'available':
      return 'Материалы в наличии'
    case 'incoming':
      return 'Не хватает сейчас, закрывается ожидаемой поставкой'
    case 'unavailable':
      return 'Не хватает материалов'
    default:
      return 'Не хватает материалов'
  }
}

export function toDatetimeLocalValue(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatRequirementLine(r: RepeatRequirement) {
  const name = [r.brand, r.product_name].filter(Boolean).join(' ') || 'Материал'
  const unit = r.unit ? ` ${r.unit}` : ''
  if (r.status === 'available') return `${name} — ${r.required_qty}${unit}`
  return `${name} — нужно ${r.required_qty}${unit}, в наличии ${r.available_qty}${unit}`
}

export function soonestIncomingDate(requirements: RepeatRequirement[]) {
  const dates = requirements.map((r) => r.expected_at).filter(Boolean) as string[]
  if (dates.length === 0) return null
  return dates.sort()[0]
}
