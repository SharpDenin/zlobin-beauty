import { describe, expect, it } from 'vitest'
import {
  emptyRecommendationMessage,
  knowledgeProductPath,
  knowledgeServiceQuery,
  recommendationContextLabel,
  shortageKnowledgeLabel,
  productAudienceLabel,
  articleAudienceBadges,
  clientVisibleProducts,
  knowledgeEmptyTitle,
  knowledgeCoverClearValue,
  parseKnowledgeDoc,
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

  it('uses human audience labels instead of API enums', () => {
    expect(productAudienceLabel('all')).toBe('Для домашнего ухода')
    expect(productAudienceLabel('professional_only')).toBe('Только для салонов')
    expect(productAudienceLabel(undefined)).toBe('Для домашнего ухода')
    expect(productAudienceLabel('professional_only')).not.toContain('professional')
  })

  it('builds master audience badges for home, professional and mixed articles', () => {
    expect(articleAudienceBadges({ home_care: true, professional: false, audience_kind: 'home' })).toEqual([
      { id: 'home', label: 'Для домашнего ухода' },
    ])
    expect(articleAudienceBadges({ home_care: false, professional: true, audience_kind: 'professional' })).toEqual([
      { id: 'pro', label: 'Профессиональный материал' },
    ])
    expect(articleAudienceBadges({ home_care: true, professional: true, audience_kind: 'mixed' })).toHaveLength(2)
  })

  it('hides professional products from client related lists', () => {
    const items = [
      { id: '1', audience: 'all' },
      { id: '2', audience: 'professional_only' },
    ]
    expect(clientVisibleProducts(items, false).map((p) => p.id)).toEqual(['1'])
    expect(clientVisibleProducts(items, true)).toHaveLength(2)
  })

  it('uses role-aware empty copy', () => {
    expect(knowledgeEmptyTitle(false, false)).toBe('В базе знаний пока нет материалов для домашнего ухода.')
    expect(knowledgeEmptyTitle(true, false)).toBe('Материалы не найдены.')
  })

  it('clears article cover with empty string, not a placeholder id', () => {
    expect(knowledgeCoverClearValue('abc')).toBe('abc')
    expect(knowledgeCoverClearValue(null)).toBe('')
    expect(knowledgeCoverClearValue(undefined)).toBe('')
  })

  it('loads article docs from JSON objects or strings', () => {
    const obj = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Majirel' }] }] }
    expect(parseKnowledgeDoc(obj, 'doc_json')).toEqual(obj)
    expect(parseKnowledgeDoc(JSON.stringify(obj), 'doc_json')).toEqual(obj)
    expect(parseKnowledgeDoc({ content: obj.content }, 'doc_json')).toEqual(obj)
    expect(parseKnowledgeDoc([obj], 'doc_json')).toEqual(obj)
    expect(parseKnowledgeDoc(undefined, 'doc_json').type).toBe('doc')
  })
})
