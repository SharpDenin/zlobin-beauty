import { describe, expect, it } from 'vitest'
import { isTokenFresh, jwtExpiryMs } from '@/features/auth/session-storage'

function fakeJwt(expSeconds: number): string {
  const payload = btoa(JSON.stringify({ exp: expSeconds, uid: 'u1' })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `header.${payload}.sig`
}

describe('session token helpers', () => {
  it('decodes the expiry of a JWT', () => {
    expect(jwtExpiryMs(fakeJwt(1_800_000_000))).toBe(1_800_000_000_000)
    expect(jwtExpiryMs('not-a-jwt')).toBeNull()
    expect(jwtExpiryMs(null)).toBeNull()
  })

  it('treats tokens that are about to expire as stale so uploads refresh first', () => {
    const now = 1_000_000_000_000
    expect(isTokenFresh(fakeJwt(now / 1000 + 600), 45_000, now)).toBe(true)
    expect(isTokenFresh(fakeJwt(now / 1000 + 20), 45_000, now)).toBe(false)
    expect(isTokenFresh(fakeJwt(now / 1000 - 5), 45_000, now)).toBe(false)
    expect(isTokenFresh('garbage', 45_000, now)).toBe(false)
  })
})
