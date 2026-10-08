import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest, bindAuthBridge, getFreshAccessToken } from '@/shared/api/client'
import { SESSION_STORAGE_KEY } from '@/features/auth/session-storage'

function jwt(expiresInSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds
  const payload = btoa(JSON.stringify({ exp })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `h.${payload}.s`
}

type Call = { url: string; auth: string | null; body?: string }
let calls: Call[] = []
let session: { accessToken: string; refreshToken: string } | null = null
let cleared: string[] = []
let refreshAnswer: () => Response

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function installBridge() {
  bindAuthBridge({
    getSession: () => session,
    setSession: (next, persist = true) => {
      session = { accessToken: next.accessToken, refreshToken: next.refreshToken }
      if (persist) localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
    },
    clearSession: (reason) => {
      cleared.push(reason)
      session = null
      localStorage.removeItem(SESSION_STORAGE_KEY)
    },
  })
}

beforeEach(() => {
  calls = []
  cleared = []
  session = null
  localStorage.clear()
  // A different expiry than the fixtures' 900s so a renewed token is distinguishable from the old one.
  refreshAnswer = () => json(200, { access_token: jwt(1800), refresh_token: 'r2', user: { id: 'u1' } })
  installBridge()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const headers = (init?.headers ?? {}) as Record<string, string>
      calls.push({ url, auth: headers.Authorization ?? null, body: init?.body as string | undefined })
      if (url.endsWith('/v1/auth/refresh')) return refreshAnswer()
      if (url.endsWith('/v1/auth/login')) return json(200, { access_token: 'a', refresh_token: 'b' })
      return json(200, { ok: true, auth: headers.Authorization ?? null })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiRequest session handling', () => {
  it('renews an expired access token BEFORE sending the request', async () => {
    session = { accessToken: jwt(-30), refreshToken: 'r1' }
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
    const res = await apiRequest<{ auth: string }>('/v1/me/things', { token: session.accessToken })
    const refreshCalls = calls.filter((c) => c.url.endsWith('/v1/auth/refresh'))
    expect(refreshCalls).toHaveLength(1)
    expect(res.auth).toBe(`Bearer ${session?.accessToken}`)
  })

  it('runs a single refresh for concurrent requests on an expired token', async () => {
    session = { accessToken: jwt(-30), refreshToken: 'r1' }
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
    await Promise.all([apiRequest('/v1/a'), apiRequest('/v1/b'), apiRequest('/v1/c')])
    expect(calls.filter((c) => c.url.endsWith('/v1/auth/refresh'))).toHaveLength(1)
  })

  it('retries once with a refreshed token when the server says 401', async () => {
    const live = jwt(900)
    session = { accessToken: live, refreshToken: 'r1' }
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
    let first = true
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const headers = (init?.headers ?? {}) as Record<string, string>
      calls.push({ url, auth: headers.Authorization ?? null })
      if (url.endsWith('/v1/auth/refresh')) return refreshAnswer()
      if (first) {
        first = false
        return json(401, { error: { code: 'session_expired', message: 'session expired' } })
      }
      return json(200, { ok: true })
    })
    await expect(apiRequest('/v1/protected')).resolves.toEqual({ ok: true })
    expect(cleared).toEqual([])
  })

  it('ends the session as expired only when the refresh token is definitively rejected', async () => {
    session = { accessToken: jwt(-30), refreshToken: 'r1' }
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
    refreshAnswer = () => json(401, { error: { code: 'session_expired', message: 'session expired' } })
    await getFreshAccessToken()
    expect(cleared).toEqual(['expired'])
  })

  it('keeps the session when the refresh endpoint is merely down', async () => {
    session = { accessToken: jwt(-30), refreshToken: 'r1' }
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
    refreshAnswer = () => json(503, { error: { code: 'upstream_unavailable', message: 'down' } })
    await getFreshAccessToken()
    expect(cleared).toEqual([])
    expect(session).not.toBeNull()
  })

  it('adopts the pair another tab already stored instead of refreshing with a rotated token', async () => {
    session = { accessToken: jwt(-30), refreshToken: 'old-refresh' }
    const siblingAccess = jwt(900)
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ accessToken: siblingAccess, refreshToken: 'sibling-refresh' }))
    const token = await getFreshAccessToken()
    expect(token).toBe(siblingAccess)
    expect(calls.filter((c) => c.url.endsWith('/v1/auth/refresh'))).toHaveLength(0)
  })

  it('never attaches a stale bearer to login/register/refresh', async () => {
    session = { accessToken: jwt(900), refreshToken: 'r1' }
    await apiRequest('/v1/auth/login', { body: { email: 'a@b.c', password: 'x' }, skipAuthRefresh: true })
    expect(calls.at(-1)?.auth).toBeNull()
  })

  it('does not treat a 401 without any session as an expiry', async () => {
    session = null
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (input: RequestInfo | URL) => {
      calls.push({ url: String(input), auth: null })
      return json(401, { error: { code: 'unauthorized', message: 'authentication required' } })
    })
    await expect(apiRequest('/v1/me/things')).rejects.toMatchObject({ status: 401 })
    expect(cleared).toEqual([])
    expect(calls.filter((c) => c.url.endsWith('/v1/auth/refresh'))).toHaveLength(0)
  })
})
