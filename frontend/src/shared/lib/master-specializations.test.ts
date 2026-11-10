import { describe, expect, it } from 'vitest'
import {
  MASTER_SPECIALIZATION_CATALOG,
  filterSpecializationsForSlugs,
  incompatibleSpecializations,
  specializationsForSlugs,
  uniqueSpecializationTags,
} from '@/shared/lib/master-specializations'

describe('master-specializations catalog', () => {
  it('covers every known profession slug with non-empty unique tags', () => {
    const slugs = Object.keys(MASTER_SPECIALIZATION_CATALOG)
    expect(slugs).toEqual(
      expect.arrayContaining([
        'colorist',
        'hairdresser',
        'barber',
        'nail_master',
        'pedicure_master',
        'brow_lash',
        'cosmetologist',
      ]),
    )
    for (const slug of slugs) {
      const tags = MASTER_SPECIALIZATION_CATALOG[slug]
      expect(tags.length).toBeGreaterThan(0)
      expect(uniqueSpecializationTags([...tags])).toHaveLength(tags.length)
    }
  })

  it('builds union without duplicates across slugs', () => {
    const tags = specializationsForSlugs(['nail_master', 'pedicure_master'])
    const lower = tags.map((t) => t.toLocaleLowerCase('ru'))
    expect(new Set(lower).size).toBe(lower.length)
    expect(tags).toContain('Классический маникюр')
    expect(tags).toContain('Классический педикюр')
  })

  it('filters incompatible tags when profession type changes', () => {
    const current = ['Балаяж', 'Фейд', 'Чистка лица']
    expect(filterSpecializationsForSlugs(current, ['colorist'])).toEqual(['Балаяж'])
    expect(incompatibleSpecializations(current, ['colorist'])).toEqual(['Фейд', 'Чистка лица'])
  })
})
