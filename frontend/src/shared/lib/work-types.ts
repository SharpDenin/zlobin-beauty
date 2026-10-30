/** Canonical master work formats — not profession types, not org roles, not booking modes. */

export const WORK_TYPE_ALIASES: Record<string, string> = {
  independent: 'private_practice',
  private_master: 'private_practice',
  mobile_master: 'mobile_service',
  renter: 'chair_rental',
  chair_master: 'chair_rental',
}

const LABELS: Record<string, string> = {
  private_practice: 'Частный мастер',
  percentage_based: 'На процентах',
  mobile_service: 'Выездной мастер',
  chair_rental: 'На кресле',
  // Legacy display only (not selectable)
  independent: 'Частный мастер',
  private_master: 'Частный мастер',
  mobile_master: 'Выездной мастер',
  renter: 'На кресле',
  chair_master: 'На кресле',
  employee: 'Сотрудник салона (устаревшее значение формата)',
  salon_owner: 'Владелец салона',
  chain_owner: 'Владелец сети',
  owner: 'Владелец салона',
}

export const OWNERSHIP_WORK_TYPE_CODES = new Set(['owner', 'salon_owner', 'chain_owner'])
export const LEGACY_NON_FORMAT_CODES = new Set(['employee', ...OWNERSHIP_WORK_TYPE_CODES])

/** Unique options for registration / profile multi-select. */
export const CANONICAL_WORK_TYPE_OPTIONS = [
  { value: 'private_practice', label: LABELS.private_practice },
  { value: 'percentage_based', label: LABELS.percentage_based },
  { value: 'mobile_service', label: LABELS.mobile_service },
  { value: 'chair_rental', label: LABELS.chair_rental },
] as const

export type CanonicalWorkType = (typeof CANONICAL_WORK_TYPE_OPTIONS)[number]['value']

export function normalizeWorkType(value: string | null | undefined): string {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return ''
  if (OWNERSHIP_WORK_TYPE_CODES.has(raw)) return ''
  return WORK_TYPE_ALIASES[raw] ?? raw
}

export function isCanonicalWorkType(value: string): value is CanonicalWorkType {
  return CANONICAL_WORK_TYPE_OPTIONS.some((o) => o.value === value)
}

export function workTypeLabel(workType: string | null | undefined): string {
  if (!workType) return 'Не указан'
  const n = normalizeWorkType(workType)
  return LABELS[workType] ?? LABELS[n] ?? workType
}

export function workTypesLabel(types: string[] | null | undefined): string {
  const uniq = uniqueCanonicalWorkTypes(types ?? [])
  const legacy = (types ?? []).map((t) => String(t).trim().toLowerCase()).filter((t) => LEGACY_NON_FORMAT_CODES.has(t))
  const parts = [
    ...uniq.map((t) => workTypeLabel(t)),
    ...legacy.map((t) => workTypeLabel(t)),
  ]
  if (!parts.length) return 'Не указан'
  return parts.join(' · ')
}

/** Canonical formats only — ownership and employee are excluded from selectable set. */
export function uniqueCanonicalWorkTypes(values: string[]): CanonicalWorkType[] {
  const seen = new Set<string>()
  const out: CanonicalWorkType[] = []
  for (const v of values) {
    const n = normalizeWorkType(v)
    if (!isCanonicalWorkType(n) || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

/** Primary = first canonical element (order preserved). */
export function primaryWorkType(types: string[]): CanonicalWorkType {
  const uniq = uniqueCanonicalWorkTypes(types)
  return uniq[0] ?? 'private_practice'
}

export function hasLegacyEmployeeFormat(types: string[] | string | null | undefined): boolean {
  const list = Array.isArray(types) ? types : types ? [types] : []
  return list.some((t) => String(t).trim().toLowerCase() === 'employee')
}

/**
 * Org membership — not work format — drives salon binding.
 * Kept for call-site compatibility; always false for formats alone.
 */
export function workTypeNeedsSalon(_types?: string[] | string | null): boolean {
  return false
}

export function isSelfServeWorkType(_value: string): boolean {
  return true
}
