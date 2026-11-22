import test from 'node:test'
import assert from 'node:assert/strict'
import { mapEpicaToCommerceSlug } from './epica-category-map.mjs'

test('oxidizers map to okislitel not kraska', () => {
  assert.equal(
    mapEpicaToCommerceSlug(
      'Окрашивание и осветление / Окрашивание / Окисляющая эмульсия',
      'Кремообразная окисляющая эмульсия 1,5% «OXY ACTIVE», 1000 мл',
    ),
    'okislitel',
  )
})

test('cream dye stays kraska', () => {
  assert.equal(
    mapEpicaToCommerceSlug(
      'Окрашивание и осветление / Окрашивание / Крем краска',
      'COLORSHADE 0.0a Крем-краска КОРРЕКТОР аммиачный, 100 мл.',
    ),
    'kraska',
  )
})

test('shampoo by title maps to shampun even under coloring / men paths', () => {
  assert.equal(
    mapEpicaToCommerceSlug(
      'Окрашивание и осветление / Техническая серия',
      'Шампунь для глубокого очищения волос «PURE SOLUTION», 1000 мл',
    ),
    'shampun',
  )
  assert.equal(
    mapEpicaToCommerceSlug(
      'Для мужчин / Уход',
      'Мужской шампунь с кондиционирующим эффектом «MEN’S», 1000 мл',
    ),
    'shampun',
  )
})

test('men non-shampoo and hand care map to uhod', () => {
  assert.equal(
    mapEpicaToCommerceSlug('Для мужчин / Уход', 'Мужской кондиционер с охлаждающим эффектом «MEN’S», 250 мл'),
    'uhod',
  )
  assert.equal(
    mapEpicaToCommerceSlug('Для мужчин / Для бритья', 'Охлаждающий гель для бритья «MEN’S», 100 мл'),
    'uhod',
  )
  assert.equal(
    mapEpicaToCommerceSlug('Уход за кожей рук / Крем', 'Крем для рук увлажняющий, 75 мл'),
    'uhod',
  )
})

test('mask by title maps to maska', () => {
  assert.equal(
    mapEpicaToCommerceSlug(
      'Уход за волосами / Для блонда',
      'Маска для волос с фиолетовым пигментом «COLD BLOND», 250 мл',
    ),
    'maska',
  )
})

test('styling top maps to stajling', () => {
  assert.equal(
    mapEpicaToCommerceSlug('Стайлинг / Лак', 'Лак для волос сверхсильной фиксации «EXTRA STRONG», 400 мл'),
    'stajling',
  )
})

test('accessories map to aksessuary', () => {
  assert.equal(mapEpicaToCommerceSlug('Аксессуары / Кисти', 'Кисть для окрашивания 48 мм'), 'aksessuary')
  assert.equal(
    mapEpicaToCommerceSlug('Завивка / Термобумага', 'Термобумага для всех видов окрашивания, 10*30 см, 50 шт'),
    'aksessuary',
  )
})

test('perm and neutralizer map to zavivka', () => {
  assert.equal(
    mapEpicaToCommerceSlug('Завивка / Перманент', 'Перманент #2 для нормальных волос «SHAPE WAVE», 100 мл'),
    'zavivka',
  )
  assert.equal(
    mapEpicaToCommerceSlug('Завивка / Нейтрализатор', 'Универсальный нейтрализатор 1+1 «SHAPE WAVE», 100 мл'),
    'zavivka',
  )
})

test('kits map to nabory', () => {
  assert.equal(
    mapEpicaToCommerceSlug(
      'Наборы',
      'Набор Amber Shine Organic (шампунь 250мл+кондиционер 250мл+маска 250мл)',
    ),
    'nabory',
  )
})
