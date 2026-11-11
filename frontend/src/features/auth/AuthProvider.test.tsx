import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider'
import { SESSION_STORAGE_KEY } from '@/features/auth/session-storage'
import { SESSION_ENDED_KEY, markSessionEnded, peekSessionEnded } from '@/features/pwa/pwa'
import { apiRequest } from '@/shared/api/client'

function jwt(expiresInSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds
  const payload = btoa(JSON.stringify({ exp })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `h.${payload}.s`
}

const user = { id: 'u1', email: 'a@b.c', phone: null, display_name: 'Анна', city: '', roles: ['client'], status: 'active' }

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>

function store(accessExpiresIn: number) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ accessToken: jwt(accessExpiresIn), refreshToken: 'r1', user }))
}

let handler: (url: string) => Response | Promise<Response>

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  handler = () => json(200, {})
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => handler(String(input))),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AuthProvider session lifecycle', () => {
  it('renews an expired access token on startup without bothering the user', async () => {
    store(-60)
    handler = (url) => {
      if (url.endsWith('/v1/auth/refresh')) return json(200, { access_token: jwt(900), refresh_token: 'r2', user })
      if (url.endsWith('/v1/auth/me')) return json(200, user)
      return json(200, {})
    }
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user?.id).toBe('u1')
    expect(peekSessionEnded()).toBe(false)
  })

  it('shows the soft expired notice only when the server definitively rejects the refresh token', async () => {
    store(-60)
    handler = (url) =>
      url.endsWith('/v1/auth/refresh') ? json(401, { error: { code: 'session_expired', message: 'session expired' } }) : json(200, {})
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toBeNull()
    expect(peekSessionEnded()).toBe(true)
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })

  it('keeps the session (no notice, still signed in) when the server is unreachable at startup', async () => {
    store(-60)
    handler = () => {
      throw new TypeError('Failed to fetch')
    }
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user?.id).toBe('u1')
    expect(peekSessionEnded()).toBe(false)
  })

  it('a normal logout never leaves an "expired" notice, even if a late request gets a 401 afterwards', async () => {
    store(900)
    handler = (url) => {
      if (url.endsWith('/v1/auth/me')) return json(200, user)
      if (url.endsWith('/v1/auth/logout')) return new Response(null, { status: 204 })
      return json(401, { error: { code: 'session_expired', message: 'session expired' } })
    }
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.logout()
    })
    // A request that was already in flight fails with 401 after the session is gone.
    await expect(apiRequest('/v1/notifications')).rejects.toMatchObject({ status: 401 })

    expect(result.current.user).toBeNull()
    expect(peekSessionEnded()).toBe(false)
    expect(sessionStorage.getItem(SESSION_ENDED_KEY)).toBeNull()
  })

  it('a successful login clears a previous expired notice', async () => {
    markSessionEnded()
    handler = (url) =>
      url.endsWith('/v1/auth/login')
        ? json(200, { access_token: jwt(900), refresh_token: 'r3', user })
        : json(200, {})
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.login('a@b.c', 'password1')
    })
    expect(result.current.user?.id).toBe('u1')
    expect(peekSessionEnded()).toBe(false)
  })

  it('logout clears locally even when server logout hangs', async () => {
    store(900)
    handler = (url) => {
      if (url.endsWith('/v1/auth/me')) return json(200, user)
      if (url.endsWith('/v1/auth/logout')) {
        return new Promise<Response>(() => undefined)
      }
      return json(200, {})
    }
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user?.id).toBe('u1')

    const logoutPromise = result.current.logout()
    // Session must be cleared on the first click, before server logout resolves.
    await waitFor(() => expect(result.current.user).toBeNull())
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
    expect(result.current.accessToken).toBeNull()
    expect(peekSessionEnded()).toBe(false)

    await act(async () => {
      await logoutPromise
    })
    expect(result.current.user).toBeNull()

    // Rapid second click is a no-op / already cleared.
    await act(async () => {
      await result.current.logout()
    })
    expect(result.current.user).toBeNull()
  })

  it('in-flight refresh completing after logout cannot restore the previous user', async () => {
    store(900)
    const refreshGate: { resolve?: (value: Response) => void } = {}
    let refreshArmed = false
    handler = (url) => {
      if (url.endsWith('/v1/auth/me')) return json(200, user)
      if (url.endsWith('/v1/auth/logout')) return new Response(null, { status: 204 })
      if (url.endsWith('/v1/auth/refresh')) {
        if (!refreshArmed) return json(200, { access_token: jwt(900), refresh_token: 'r2', user })
        return new Promise<Response>((resolve) => {
          refreshGate.resolve = resolve
        })
      }
      return json(200, {})
    }
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    refreshArmed = true
    const { refreshAccessToken } = await import('@/shared/api/client')
    // Force the network refresh path even though the access JWT is still fresh.
    const refreshPromise = refreshAccessToken(result.current.accessToken ?? undefined)

    await act(async () => {
      await result.current.logout()
    })
    expect(result.current.user).toBeNull()
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()

    if (!refreshGate.resolve) throw new Error('refresh gate missing')
    refreshGate.resolve(json(200, { access_token: jwt(900), refresh_token: 'r-zombie', user }))
    await expect(refreshPromise).resolves.toBeNull()
    expect(result.current.user).toBeNull()
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()

    const client = { ...user, id: 'client-b', display_name: 'Клиент Б', roles: ['client'] }
    handler = (url) =>
      url.endsWith('/v1/auth/login')
        ? json(200, { access_token: jwt(900), refresh_token: 'rc', user: client })
        : json(200, {})
    await act(async () => {
      await result.current.login('client@b.c', 'password1')
    })
    expect(result.current.user?.id).toBe('client-b')
  })

  it('account switch: master logout then client login replaces user context', async () => {
    const master = { ...user, id: 'master-a', display_name: 'Мастер А', roles: ['master'] }
    const client = { ...user, id: 'client-b', display_name: 'Клиент Б', roles: ['client'] }
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ accessToken: jwt(900), refreshToken: 'rm', user: master }),
    )
    handler = (url) => {
      if (url.endsWith('/v1/auth/me')) return json(200, master)
      if (url.endsWith('/v1/auth/logout')) return new Response(null, { status: 204 })
      if (url.endsWith('/v1/auth/login')) {
        return json(200, { access_token: jwt(900), refresh_token: 'rc', user: client })
      }
      return json(200, {})
    }
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.user?.id).toBe('master-a'))
    await act(async () => {
      await result.current.logout()
    })
    expect(result.current.user).toBeNull()
    await act(async () => {
      await result.current.login('client@b.c', 'password1')
    })
    expect(result.current.user?.id).toBe('client-b')
    expect(result.current.user?.roles).toEqual(['client'])
    expect(result.current.user?.display_name).toBe('Клиент Б')
  })
})
