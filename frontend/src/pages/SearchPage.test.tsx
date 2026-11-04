import { describe, expect, it } from 'vitest'
import { searchPageHelpers } from '@/pages/SearchPage'

const { masterDisplayName, servicesLine, priceRangeLine, locationLine, buildMastersUrl } = searchPageHelpers

describe('SearchPage helpers SEARCH-01..06', () => {
  it('falls back display name to Мастер', () => {
    expect(masterDisplayName({ id: '1', user_id: 'u', display_name: '', city: '', specializations: [], rating_avg: 0, rating_count: 0 })).toBe('Мастер')
    expect(masterDisplayName({ id: '1', user_id: 'u', display_name: '  Анна  ', city: '', specializations: [], rating_avg: 0, rating_count: 0 })).toBe('Анна')
  })

  it('renders service names without inventing data', () => {
    expect(servicesLine({ id: '1', user_id: 'u', display_name: 'A', city: '', specializations: [], rating_avg: 0, rating_count: 0 })).toBeNull()
    expect(servicesLine({
      id: '1', user_id: 'u', display_name: 'A', city: '', specializations: [], rating_avg: 0, rating_count: 0,
      service_names: ['Стрижка', 'Окрашивание'],
    })).toBe('Стрижка · Окрашивание')
  })

  it('formats a single-line price range', () => {
    expect(priceRangeLine({
      id: '1', user_id: 'u', display_name: 'A', city: '', specializations: [], rating_avg: 0, rating_count: 0,
    })).toBeNull()
    expect(priceRangeLine({
      id: '1', user_id: 'u', display_name: 'A', city: '', specializations: [], rating_avg: 0, rating_count: 0,
      price_min_minor: 150000, price_max_minor: 150000,
    })).toMatch(/1\s?500\s?₽/)
    expect(priceRangeLine({
      id: '1', user_id: 'u', display_name: 'A', city: '', specializations: [], rating_avg: 0, rating_count: 0,
      price_min_minor: 100000, price_max_minor: 250000,
    })).toMatch(/1\s?000\s?₽/)
  })

  it('shows onsite district beside city without inventing home district', () => {
    expect(locationLine({
      id: '1', user_id: 'u', display_name: 'A', city: 'Красноярск', specializations: [], rating_avg: 0, rating_count: 0,
    }, 'красноярск')).toEqual({ city: 'Красноярск', district: undefined, otherCity: false })
    expect(locationLine({
      id: '1', user_id: 'u', display_name: 'A', city: 'Красноярск', specializations: [], rating_avg: 0, rating_count: 0,
      onsite_match: { city: 'Красноярск', districts: ['Центральный'], badge: 'Выезд' },
    }, 'красноярск').district).toBe('Центральный')
  })

  it('keeps query keys and adds cursor pagination params', () => {
    const url = buildMastersUrl({
      city: 'Красноярск', q: 'колор', service: '', price_min: '10', price_max: '',
      available_on: '', include_other_cities: false, district_id: '',
    }, 'cur123')
    expect(url).toContain('/v1/masters?')
    expect(url).toContain('city=%D0%9A%D1%80%D0%B0%D1%81%D0%BD%D0%BE%D1%8F%D1%80%D1%81%D0%BA')
    expect(url).toContain('q=')
    expect(url).toContain('price_min=1000')
    expect(url).toContain('limit=20')
    expect(url).toContain('cursor=cur123')
  })
})
