export function unitLabel(unit: string | null | undefined): string {
  if (!unit) return ''
  const map: Record<string, string> = {
    pcs: 'шт',
    ml: 'мл',
    g: 'г',
    kg: 'кг',
    l: 'л',
    pack: 'уп',
  }
  return map[unit] ?? unit
}

export function availabilityLabel(forSale: boolean | undefined, published: boolean | undefined): string {
  if (published === false) return 'Черновик'
  if (forSale === false) return 'Нет в продаже'
  return 'В наличии'
}
