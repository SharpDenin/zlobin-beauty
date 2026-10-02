import { describe, expect, it } from 'vitest'
import { CONTENT_NOT_ALLOWED_MESSAGE, moderationError, textContainsForbiddenWords } from './moderation'

describe('moderation', () => {
  it('allows ordinary salon copy', () => {
    expect(textContainsForbiddenWords('Стрижка каре и окрашивание корней')).toBe(false)
    expect(moderationError('Тупой срез у виска')).toBeNull()
  })

  it('flags obvious profanity without exposing the match', () => {
    expect(textContainsForbiddenWords('это пиздец')).toBe(true)
    expect(moderationError('fuck this')).toBe(CONTENT_NOT_ALLOWED_MESSAGE)
  })
})
