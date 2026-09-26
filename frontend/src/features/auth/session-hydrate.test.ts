import { describe, expect, it } from 'vitest'
import { ApiError } from '@/shared/api/client'
import { decideHydrateFailure, isUnauthorizedSessionError } from './session-hydrate'

describe('session hydrate', () => {
  it('does not treat network failures as an expired session', () => {
    expect(isUnauthorizedSessionError(new TypeError('Failed to fetch'))).toBe(false)
    expect(decideHydrateFailure(new TypeError('Failed to fetch'), null)).toBe('keep')
  })

  it('expires only when the server rejects the session', () => {
    const expired = new ApiError('unauthorized', 'unauthorized', 401)
    expect(decideHydrateFailure(expired, expired)).toBe('expire')
    expect(decideHydrateFailure(expired, new TypeError('Failed to fetch'))).toBe('keep')
  })

  it('keeps the stored session on a 5xx refresh failure', () => {
    const me = new ApiError('server', 'error', 500)
    const refresh = new ApiError('server', 'error', 503)
    expect(decideHydrateFailure(me, refresh)).toBe('keep')
  })
})
