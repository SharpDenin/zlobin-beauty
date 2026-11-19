/**
 * Canonical cutting techniques (methods). Keep in sync with
 * backend/services/marketplace/internal/domain/cutting_techniques.go
 */
export const CUTTING_TECHNIQUE_CATALOG = [
  'Тупой срез',
  'Градуировка',
  'Слои',
  'Пойнт-кат',
  'Слайд-кат',
  'Слайс',
  'Филировка',
  'Текстурирование',
  'Бритвенная техника',
  'Ножницы над расчёской',
  'Машинка над расчёской',
  'Фейд',
  'Коннектинг',
  'Фрихэнд',
] as const

export type CuttingTechnique = (typeof CUTTING_TECHNIQUE_CATALOG)[number]

function keyOf(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru')
}

const catalogByKey = new Map(CUTTING_TECHNIQUE_CATALOG.map((t) => [keyOf(t), t] as const))

export function normalizeCuttingTechniques(raw: readonly string[] | null | undefined): string[] {
  if (!raw?.length) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const canon = catalogByKey.get(keyOf(item))
    if (!canon) continue
    const k = keyOf(canon)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(canon)
  }
  return out
}
