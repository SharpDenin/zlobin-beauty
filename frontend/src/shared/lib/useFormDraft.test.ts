import { describe, expect, it } from 'vitest'
import { isSensitiveFieldName, sanitizeDraft } from '@/shared/lib/useFormDraft'

describe('useFormDraft helpers', () => {
  it('never stores sensitive-looking fields', () => {
    expect(isSensitiveFieldName('password')).toBe(true)
    expect(isSensitiveFieldName('confirmPassword')).toBe(true)
    expect(isSensitiveFieldName('cardNumber')).toBe(true)
    expect(isSensitiveFieldName('display_name')).toBe(false)
  })

  it('drops excluded, sensitive and binary values', () => {
    const draft = sanitizeDraft(
      { display_name: 'Анна', password: 'x', comment: 'привет', file: new Blob(['a']), secretNote: 'no' },
      ['comment'],
    )
    expect(draft).toEqual({ display_name: 'Анна' })
  })
})
