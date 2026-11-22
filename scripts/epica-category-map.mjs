/**
 * Map EPICA official category path (+ product title) onto commerce category slugs.
 * Flat catalog — no hierarchy.
 *
 * Slugs: kraska | okislitel | shampun | uhod | maska | stajling | aksessuary | zavivka | nabory
 */

export const COMMERCE_CATEGORY_SLUGS = Object.freeze([
  'kraska',
  'okislitel',
  'shampun',
  'uhod',
  'maska',
  'stajling',
  'aksessuary',
  'zavivka',
  'nabory',
])

/**
 * @param {string} categoryPath e.g. "Окрашивание и осветление / Окрашивание / Окисляющая эмульсия"
 * @param {string} [title]
 * @returns {(typeof COMMERCE_CATEGORY_SLUGS)[number]}
 */
export function mapEpicaToCommerceSlug(categoryPath, title = '') {
  const path = String(categoryPath || '')
  const name = String(title || '')
  const pathL = path.toLowerCase()
  const nameL = name.toLowerCase()
  const parts = path.split('/').map((s) => s.trim()).filter(Boolean)
  const top = (parts[0] || '').toLowerCase()
  const leaf = (parts[parts.length - 1] || '').toLowerCase()

  // Developers / oxidizers — never under Краска.
  if (
    leaf.includes('окисляющ') ||
    pathL.includes('окисляющ') ||
    nameL.includes('окисляющ') ||
    nameL.includes('oxy active') ||
    /\bproxy\b/i.test(name)
  ) {
    return 'okislitel'
  }

  if (top.includes('стайлинг')) return 'stajling'

  // Accessories (EPICA top) + perm thermopaper (tooling, not chemistry).
  if (top.includes('аксессуар')) return 'aksessuary'
  if (top.includes('завив') && (leaf.includes('термобумаг') || nameL.includes('термобумаг'))) {
    return 'aksessuary'
  }

  // Chemical waving + neutralizers.
  if (top.includes('завив')) return 'zavivka'

  // Kits — dedicated category (titles often mention шампунь/маска).
  if (top.includes('набор') || nameL.startsWith('набор')) return 'nabory'

  // Product-type signals beat the coarse EPICA path tree (e.g. technical shampoos under «Окрашивание»).
  // Men's shampoos land in shampun; other men's / hand care fall through to uhod.
  if (leaf.includes('шампунь') || nameL.includes('шампунь')) return 'shampun'
  if (nameL.includes('маска')) return 'maska'

  // Color / lightening family (dyes, toners, bleach powders).
  if (top.includes('окрашивание')) {
    if (nameL.includes('лосьон') || nameL.includes('skin cleaner') || nameL.includes('удаления краски')) {
      return 'uhod'
    }
    return 'kraska'
  }

  // Remaining hair care, men's non-shampoo, hand care → Уход.
  return 'uhod'
}

export function mapEpicaCategoryId(categoryPath, title, slugToId) {
  const slug = mapEpicaToCommerceSlug(categoryPath, title)
  const id = slugToId?.[slug]
  if (!id) throw new Error(`missing commerce category id for slug=${slug}`)
  return { slug, category_id: id }
}
