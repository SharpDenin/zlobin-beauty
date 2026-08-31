import { describe, expect, it } from 'vitest'
import { productAudienceLabel } from './knowledge-helpers'
import {
  supplierCatalogQuery,
  supplierHasActiveFilters,
  supplierOrderIsTerminal,
  supplierPhotoClearValue,
  supplierProductMatches,
  supplierProductWriteBody,
} from './supplier-helpers'

describe('supplier helpers', () => {
  it('sends empty string to clear product photo on update', () => {
    expect(supplierPhotoClearValue('abc', false)).toBe('abc')
    expect(supplierPhotoClearValue(null, true)).toBeNull()
    expect(supplierPhotoClearValue(null, false)).toBe('')
  })

  it('writes only API-known product fields', () => {
    const created = supplierProductWriteBody({
      isNew: true,
      organizationId: 'org-s',
      photoMediaId: null,
      values: {
        name: 'Otium',
        brand: 'Estel',
        description: 'Уход',
        price_rubles: 12.5,
        volume_label: '250 мл',
        unit: 'ml',
        sku: 'OT-1',
        delivery_days: 3,
        for_sale: true,
        published: true,
        audience: 'all',
        category_id: 'cat-1',
      },
    })
    expect(created).toMatchObject({
      organization_id: 'org-s',
      name: 'Otium',
      price_minor: 1250,
      photo_media_id: null,
      min_stock: 0,
      category_id: 'cat-1',
    })
    expect(created).not.toHaveProperty('category')

    const updated = supplierProductWriteBody({
      isNew: false,
      organizationId: 'org-s',
      photoMediaId: 'media-1',
      values: {
        name: 'Otium',
        brand: 'Estel',
        price_rubles: 10,
        unit: 'ml',
        delivery_days: 2,
        for_sale: true,
        published: true,
        audience: 'professional_only',
      },
    })
    expect(updated).not.toHaveProperty('organization_id')
    expect(updated).not.toHaveProperty('min_stock')
    expect(updated).not.toHaveProperty('category')
    expect(updated.photo_media_id).toBe('media-1')
  })

  it('filters catalog by query, audience and category', () => {
    const pro = { name: 'Majirel', brand: 'Loreal', audience: 'professional_only', category: 'Краска' }
    const home = { name: 'Otium Aqua', brand: 'Estel', audience: 'all', category: 'Шампунь' }
    const f = supplierCatalogQuery('otium', '', '')
    expect(supplierProductMatches(home, f)).toBe(true)
    expect(supplierProductMatches(pro, f)).toBe(false)
    expect(supplierProductMatches(pro, { q: '', audience: 'professional_only', category: '' })).toBe(true)
    expect(supplierProductMatches(home, { q: '', audience: 'professional_only', category: '' })).toBe(false)
    expect(supplierProductMatches(
      { name: 'Otium Aqua', category_id: 'cat-1', audience: 'all' },
      { q: '', audience: '', category: 'cat-1' },
    )).toBe(true)
    expect(productAudienceLabel(pro.audience)).toBe('Только для салонов')
  })

  it('detects active filters and terminal orders', () => {
    expect(supplierHasActiveFilters('', '', '')).toBe(false)
    expect(supplierHasActiveFilters('  estel', '', '')).toBe(true)
    expect(supplierOrderIsTerminal('delivered')).toBe(true)
    expect(supplierOrderIsTerminal('new')).toBe(false)
  })
})
