/** Canonical master work formats (employment model) — not profession types. */

export const WORK_TYPE_ALIASES: Record<string, string> = {
  chair_master: 'renter',
  private_master: 'independent',
  owner: 'salon_owner',
}

const LABELS: Record<string, string> = {
  independent: 'Частный мастер',
  mobile_master: 'Мастер на дому / выезд',
  employee: 'Мастер на процентах / сотрудник салона',
  renter: 'Мастер с рабочим местом в салоне',
  salon_owner: 'Владелец салона',
  chain_owner: 'Владелец сети',
  // Legacy display (normalized away for new picks)
  chair_master: 'Мастер с рабочим местом в салоне',
  private_master: 'Частный мастер',
  owner: 'Владелец салона',
}

/** Unique options for registration / profile multi-select. */
export const CANONICAL_WORK_TYPE_OPTIONS = [
  { value: 'independent', label: LABELS.independent },
  { value: 'mobile_master', label: LABELS.mobile_master },
  { value: 'employee', label: LABELS.employee },
  { value: 'renter', label: LABELS.renter },
  { value: 'salon_owner', label: LABELS.salon_owner },
  { value: 'chain_owner', label: LABELS.chain_owner },
] as const

export type CanonicalWorkType = (typeof CANONICAL_WORK_TYPE_OPTIONS)[number]['value']

const PRIORITY: CanonicalWorkType[] = [
  'chain_owner',
  'salon_owner',
  'employee',
  'renter',
  'mobile_master',
  'independent',
]

export function normalizeWorkType(value: string | null | undefined): string {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return 'independent'
  return WORK_TYPE_ALIASES[raw] ?? raw
}

export function workTypeLabel(workType: string | null | undefined): string {
  if (!workType) return 'Не указан'
  const n = normalizeWorkType(workType)
  return LABELS[workType] ?? LABELS[n] ?? workType
}

export function workTypesLabel(types: string[] | null | undefined): string {
  const uniq = uniqueCanonicalWorkTypes(types ?? [])
  if (!uniq.length) return 'Не указан'
  return uniq.map((t) => workTypeLabel(t)).join(' · ')
}

export function uniqueCanonicalWorkTypes(values: string[]): CanonicalWorkType[] {
  const seen = new Set<string>()
  const out: CanonicalWorkType[] = []
  for (const v of values) {
    const n = normalizeWorkType(v)
    if (!LABELS[n] || n === 'owner' || n === 'chair_master' || n === 'private_master') {
      // only accept canonical keys present in options
    }
    const canon = n as CanonicalWorkType
    if (!CANONICAL_WORK_TYPE_OPTIONS.some((o) => o.value === canon)) continue
    if (seen.has(canon)) continue
    seen.add(canon)
    out.push(canon)
  }
  return out
}

export function primaryWorkType(types: string[]): CanonicalWorkType {
  const uniq = uniqueCanonicalWorkTypes(types)
  if (!uniq.length) return 'independent'
  for (const p of PRIORITY) {
    if (uniq.includes(p)) return p
  }
  return uniq[0]
}

export function workTypeNeedsSalon(types: string[] | string | null | undefined): boolean {
  const list = Array.isArray(types) ? types : types ? [types] : []
  const uniq = uniqueCanonicalWorkTypes(list)
  return uniq.some((t) => t === 'employee' || t === 'renter' || t === 'salon_owner' || t === 'chain_owner')
}

export function isSelfServeWorkType(value: string): boolean {
  return value !== 'chain_owner'
}
