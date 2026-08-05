export function formatMoney(minor: number, currency = 'RUB'): string {
  const value = Math.round(minor / 100)
  if (currency === 'RUB') return `${value.toLocaleString('ru-RU')} ₽`
  return `${value.toLocaleString('ru-RU')} ${currency}`
}
