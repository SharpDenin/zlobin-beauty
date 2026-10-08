import { describe, expect, it } from 'vitest'
import {
  collectPortfolioCategories,
  filterPortfolioByCategory,
  movePortfolioItem,
  teaserPortfolio,
  portfolioDisplayTitle,
  suggestPortfolioCategories,
  type PortfolioItem,
} from '@/features/portfolio/types'

function item(partial: Partial<PortfolioItem> & { id: string }): PortfolioItem {
  return {
    master_id: 'm',
    media_id: 'media',
    caption: '',
    title: '',
    description: '',
    category: '',
    media_type: 'photo',
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

describe('portfolio helpers', () => {
  it('falls back title to caption', () => {
    expect(portfolioDisplayTitle({ title: '', caption: ' Legacy ' })).toBe('Legacy')
    expect(portfolioDisplayTitle({ title: 'Title', caption: 'Cap' })).toBe('Title')
  })

  it('collects unique categories sorted', () => {
    const cats = collectPortfolioCategories([
      item({ id: '1', category: 'Укладки' }),
      item({ id: '2', category: 'Стрижки' }),
      item({ id: '3', category: 'Стрижки' }),
      item({ id: '4', category: '' }),
    ])
    expect(cats).toEqual(['Стрижки', 'Укладки'])
  })

  it('filters by category', () => {
    const items = [
      item({ id: '1', category: 'Стрижки' }),
      item({ id: '2', category: 'Окрашивание' }),
    ]
    expect(filterPortfolioByCategory(items, 'Все')).toHaveLength(2)
    expect(filterPortfolioByCategory(items, 'Стрижки').map((i) => i.id)).toEqual(['1'])
  })

  it('moves items up and down', () => {
    const ids = ['a', 'b', 'c']
    expect(movePortfolioItem(ids, 'b', 'up')).toEqual(['b', 'a', 'c'])
    expect(movePortfolioItem(ids, 'b', 'down')).toEqual(['a', 'c', 'b'])
    expect(movePortfolioItem(ids, 'a', 'up')).toEqual(['a', 'b', 'c'])
  })

  it('keeps a short teaser for the profile', () => {
    expect(teaserPortfolio([1, 2, 3, 4, 5, 6, 7, 8]).length).toBe(6)
    expect(teaserPortfolio([1, 2], 6)).toEqual([1, 2])
  })

  it('suggests categories from services and professions', () => {
    expect(suggestPortfolioCategories(['Стрижки', 'Стрижки'], ['Колорист'])).toEqual([
      'Стрижки',
      'Колорист',
    ])
  })
})
