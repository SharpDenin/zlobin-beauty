import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  abortInFlightRequests,
  bindAuthBridge,
  getAuthEpoch,
  refreshAccessToken,
} from '@/shared/api/client'
import { SESSION_STORAGE_KEY } from '@/features/auth/session-storage'

function jwt(expiresInSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds
  const payload = btoa(JSON.stringify({ exp })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `h.${payload}.s`
}

describe('refresh vs logout race', () => {
  let setSession: ReturnType<typeof vi.fn>
  let clearSession: ReturnType<typeof vi.fn>
  let session: { accessToken: string; refreshToken: string } | null

  beforeEach(() => {
    localStorage.clear()
    setSession = vi.fn((next: { accessToken: string; refreshToken: string }) => {
      session = { accessToken: next.accessToken, refreshToken: next.refreshToken }
      localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({ ...session, user: { id: 'u1' } }),
      )
    })
    clearSession = vi.fn(() => {
      session = null
      localStorage.removeItem(SESSION_STORAGE_KEY)
    })
    session = { accessToken: jwt(5), refreshToken: 'r-old' }
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ ...session, user: { id: 'u1' } }),
    )
    bindAuthBridge({
      getSession: () => session,
      setSession,
      clearSession,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    bindAuthBridge({
      getSession: () => null,
      setSession: () => undefined,
      clearSession: () => undefined,
    })
  })

  it('late refresh after abort does not restore credentials', async () => {
    const gate: { resolve?: (value: Response) => void } = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            gate.resolve = resolve
          }),
      ),
    )

    const epochBefore = getAuthEpoch()
    const pending = refreshAccessToken()
    // Logout path: bump epoch + clear session before refresh response arrives.
    abortInFlightRequests()
    session = null
    localStorage.removeItem(SESSION_STORAGE_KEY)
    expect(getAuthEpoch()).toBeGreaterThan(epochBefore)

    if (!gate.resolve) throw new Error('refresh gate missing')
    gate.resolve(
      new Response(
        JSON.stringify({
          access_token: jwt(900),
          refresh_token: 'r-late',
          user: { id: 'u1' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const token = await pending
    expect(token).toBeNull()
    expect(setSession).not.toHaveBeenCalled()
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })
})
