/**
 * Curated professional hair-dye brands for ManualDyeStockForm.
 * Brand remains free-text on products; this list only feeds the picker UI.
 */

export const DYE_BRAND_CANONICAL: readonly string[] = [
  "L'Oreal",
  'Wella',
  'Olaplex',
  'Estel',
  'EPICA Professional',
  'Salon-X',
  'Schwarzkopf Professional',
  'Matrix',
  'Redken',
  'Goldwell',
  'Keune',
  'Kapous Professional',
  'Cutrin',
  'Davines',
  'Kérastase',
  'Indola',
  'Londa Professional',
  'Alfaparf Milano',
] as const

/** Fold accents / punctuation so "L’Oréal", "L'Oreal", "loreal" map together. */
export function normalizeBrandKey(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[''`´’]/g, '')
    .replace(/[^a-z0-9а-яё]+/gi, '')
    .trim()
}

const CANONICAL_BY_KEY = new Map<string, string>()
for (const name of DYE_BRAND_CANONICAL) {
  CANONICAL_BY_KEY.set(normalizeBrandKey(name), name)
}

/** Extra aliases that should collapse onto a curated label. */
const ALIASES: Record<string, string> = {
  loreal: "L'Oreal",
  lorealcprofessionnel: "L'Oreal",
  lorealprofessionnel: "L'Oreal",
  epica: 'EPICA Professional',
  epicaprofessional: 'EPICA Professional',
  schwarzkopf: 'Schwarzkopf Professional',
  kapous: 'Kapous Professional',
  kerastase: 'Kérastase',
  alfaparf: 'Alfaparf Milano',
  londa: 'Londa Professional',
}

for (const [key, label] of Object.entries(ALIASES)) {
  if (!CANONICAL_BY_KEY.has(key)) CANONICAL_BY_KEY.set(key, label)
}

/** Map any brand string to the curated display form when known; otherwise trimmed input. */
export function canonicalizeBrand(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  if (!trimmed) return ''
  const key = normalizeBrandKey(trimmed)
  return CANONICAL_BY_KEY.get(key) ?? trimmed
}

/**
 * Merge curated brands with brands found on catalog products.
 * Dedupes by normalizeBrandKey; prefers curated spelling when present.
 */
export function mergeDyeBrandOptions(catalogBrands: Iterable<string>, extra?: string): string[] {
  const byKey = new Map<string, string>()
  for (const name of DYE_BRAND_CANONICAL) {
    byKey.set(normalizeBrandKey(name), name)
  }
  for (const raw of catalogBrands) {
    const canon = canonicalizeBrand(raw)
    if (!canon) continue
    const key = normalizeBrandKey(canon)
    if (!byKey.has(key)) byKey.set(key, canon)
  }
  if (extra) {
    const canon = canonicalizeBrand(extra)
    if (canon) {
      const key = normalizeBrandKey(canon)
      if (!byKey.has(key)) byKey.set(key, canon)
    }
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'ru', { sensitivity: 'base' }))
}

/** Products whose brand matches the selected picker value (after canonicalization). */
export function brandMatchesSelection(productBrand: string, selected: string): boolean {
  const a = canonicalizeBrand(productBrand)
  const b = canonicalizeBrand(selected)
  if (!a || !b) return false
  return normalizeBrandKey(a) === normalizeBrandKey(b)
}
