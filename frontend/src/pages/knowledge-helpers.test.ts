import { describe, expect, it } from 'vitest'
import {
  emptyRecommendationMessage,
  knowledgeProductPath,
  knowledgeServiceQuery,
  recommendationContextLabel,
  shortageKnowledgeLabel,
} from './knowledge-helpers'

describe('knowledge-helpers', () => {
  it('builds product and recommendation query paths', () => {
    expect(knowledgeProductPath('abc')).toBe('/knowledge?product_id=abc')
    expect(knowledgeServiceQuery({
      serviceId: 's1',
      organizationId: 'o1',
      productIds: ['p1', 'p2'],
    })).toContain('service_id=s1')
    expect(knowledgeServiceQuery({ productIds: ['p1'] })).toContain('product_id=p1')
  })

  it('labels recommendation context without inventing chemistry', () => {
    expect(recommendationContextLabel('product')).toBe('По продукту')
    expect(recommendationContextLabel('service')).toBe('По услуге')
    expect(emptyRecommendationMessage(undefined, 'product')).toContain('пока нет')
    expect(emptyRecommendationMessage('Для этого материала нет сохранённой рекомендации')).toContain('нет сохранённой')
  })

  it('maps availability status to knowledge copy', () => {
    expect(shortageKnowledgeLabel('available')).toContain('наличии')
    expect(shortageKnowledgeLabel('incoming')).toContain('пути')
    expect(shortageKnowledgeLabel('orderable')).toContain('Не хватает')
    expect(shortageKnowledgeLabel('unavailable')).toContain('Невозможно')
  })
})
