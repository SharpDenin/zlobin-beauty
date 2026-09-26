import { describe, expect, it } from 'vitest'
import { audienceLabel, auditActionLabel, knowledgeAudienceLabel, primaryRole, roleLabel } from './helpers'

describe('admin helpers', () => {
  it('maps audience codes to human labels', () => {
    expect(audienceLabel('all')).toBe('Для домашнего ухода')
    expect(audienceLabel('professional_only')).toBe('Только для салонов')
    expect(knowledgeAudienceLabel('home')).toBe('Для домашнего ухода')
    expect(knowledgeAudienceLabel('unlinked')).toBe('Без товаров')
  })

  it('summarizes roles without dumping every claim', () => {
    expect(primaryRole(['client', 'master'])).toBe(roleLabel('master'))
    expect(primaryRole(['system_admin', 'master'])).toBe(roleLabel('system_admin'))
  })

  it('labels audit actions in Russian', () => {
    expect(auditActionLabel('user.blocked')).toBe('Заблокирован пользователь')
  })
})
