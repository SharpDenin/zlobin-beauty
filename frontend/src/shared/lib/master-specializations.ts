/**
 * Canonical specialization tags keyed by profession type slug (`master_types.slug`).
 * Keep in sync with backend/services/marketplace/internal/domain/specializations.go
 */

export const MASTER_SPECIALIZATION_CATALOG: Record<string, readonly string[]> = {
  colorist: [
    'Колорирование',
    'AirTouch',
    'Балаяж',
    'Омбре',
    'Тонирование',
    'Обесцвечивание',
    'Сложное окрашивание',
    'Коррекция цвета',
  ],
  hairdresser: [
    'Женские стрижки',
    'Мужские стрижки',
    'Детские стрижки',
    'Укладки',
    'Причёски',
    'Долговременная укладка',
    'Восстановление волос',
    'Кератиновое выпрямление',
  ],
  barber: [
    'Классическое бритьё',
    'Фейд',
    'Борода и усы',
    'Детский барберинг',
    'Стрижка машинкой',
    'Камуфляж седины',
    'Уход за кожей головы',
  ],
  nail_master: [
    'Классический маникюр',
    'Аппаратный маникюр',
    'Покрытие гель-лак',
    'Наращивание ногтей',
    'Дизайн ногтей',
    'Укрепление ногтей',
    'Снятие покрытия',
  ],
  pedicure_master: [
    'Классический педикюр',
    'Аппаратный педикюр',
    'Покрытие гель-лак (педикюр)',
    'Обработка стоп',
    'SPA-педикюр',
    'Уход за кутикулой',
  ],
  brow_lash: [
    'Архитектура бровей',
    'Окрашивание бровей',
    'Ламинирование бровей',
    'Наращивание ресниц',
    'Ламинирование ресниц',
    'Коррекция бровей',
  ],
  cosmetologist: [
    'Чистка лица',
    'Уходовые процедуры',
    'Пилинги',
    'Массаж лица',
    'Антивозрастной уход',
    'Проблемная кожа',
    'Аппаратная косметология',
  ],
} as const

export type ProfessionSlug = keyof typeof MASTER_SPECIALIZATION_CATALOG

export function normalizeSpecializationTag(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

export function uniqueSpecializationTags(tags: readonly string[] | null | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of tags ?? []) {
    const tag = normalizeSpecializationTag(raw)
    if (!tag) continue
    const key = tag.toLocaleLowerCase('ru')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

/** Union of catalog tags for the given profession slugs (deduped, stable order). */
export function specializationsForSlugs(slugs: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const slug of slugs) {
    const list = MASTER_SPECIALIZATION_CATALOG[slug]
    if (!list) continue
    for (const tag of list) {
      const key = tag.toLocaleLowerCase('ru')
      if (seen.has(key)) continue
      seen.add(key)
      out.push(tag)
    }
  }
  return out
}

export function allowedSpecializationSet(slugs: readonly string[]): Set<string> {
  return new Set(specializationsForSlugs(slugs).map((t) => t.toLocaleLowerCase('ru')))
}

/** Keep only tags allowed for the selected profession slugs. Legacy tags outside the catalog are dropped. */
export function filterSpecializationsForSlugs(
  tags: readonly string[] | null | undefined,
  slugs: readonly string[],
): string[] {
  const allowed = allowedSpecializationSet(slugs)
  if (allowed.size === 0) return []
  return uniqueSpecializationTags(tags).filter((t) => allowed.has(t.toLocaleLowerCase('ru')))
}

export function incompatibleSpecializations(
  tags: readonly string[] | null | undefined,
  slugs: readonly string[],
): string[] {
  const allowed = allowedSpecializationSet(slugs)
  if (allowed.size === 0) return uniqueSpecializationTags(tags)
  return uniqueSpecializationTags(tags).filter((t) => !allowed.has(t.toLocaleLowerCase('ru')))
}

export function slugsForProfessionIds(
  ids: readonly string[],
  catalog: readonly { id: string; slug: string }[],
): string[] {
  const byId = new Map(catalog.map((t) => [t.id, t.slug]))
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    const slug = byId.get(id)
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    out.push(slug)
  }
  return out
}
