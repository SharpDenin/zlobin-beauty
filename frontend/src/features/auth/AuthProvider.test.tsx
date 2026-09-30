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

let handler: (url: string) => Response

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
})
