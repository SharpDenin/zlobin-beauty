/** Maps backend master readiness check keys to form anchors / field hints (PROF-01). */

export type ReadinessCheck = {
  key: string
  label: string
  ok: boolean
  missing?: string
}

const FIELD_BY_KEY: Record<string, { anchor: string; hint: string }> = {
  display_name: { anchor: 'display_name', hint: 'Укажите имя для публикации' },
  city: { anchor: 'master-city', hint: 'Укажите город' },
  bio: { anchor: 'master-bio', hint: 'Описание от 10 символов' },
  specializations: { anchor: 'master-specializations', hint: 'Выберите хотя бы одну специализацию из списка' },
  profession_types: { anchor: 'master-profession-types', hint: 'Выберите тип мастера' },
  experience: { anchor: 'master-experience', hint: 'Укажите опыт больше 0 лет' },
  service: { anchor: 'master-services', hint: 'Добавьте хотя бы одну услугу' },
  schedule: { anchor: 'master-schedule', hint: 'Задайте рабочее расписание' },
  profile: { anchor: 'master-profile', hint: 'Создайте профиль мастера' },
}

export function incompleteChecks(checks: ReadinessCheck[] | undefined | null): ReadinessCheck[] {
  return (checks ?? []).filter((c) => !c.ok)
}

export function readinessFieldHint(checks: ReadinessCheck[] | undefined | null, key: string): string | null {
  const hit = (checks ?? []).find((c) => c.key === key && !c.ok)
  if (!hit) return null
  return FIELD_BY_KEY[key]?.hint ?? hit.missing ?? hit.label
}

export function readinessAnchor(key: string): string | null {
  return FIELD_BY_KEY[key]?.anchor ?? null
}
