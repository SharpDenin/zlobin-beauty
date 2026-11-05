import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { apiRequest } from '@/shared/api/client'
import { usePreference } from './preferences'

vi.mock('@/shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api/client')>()
  return { ...actual, apiRequest: vi.fn() }
})

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ accessToken: 'tok' }),
}))

const toastError = vi.fn()
vi.mock('@/shared/ui/Toast', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: (...args: unknown[]) => toastError(...args),
  }),
}))

const mockedRequest = vi.mocked(apiRequest)

function wrap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
  mockedRequest.mockReset()
  toastError.mockReset()
})

afterEach(() => {
  localStorage.clear()
})

describe('usePreference', () => {
  it('persists successful PUT and restores from server on remount', async () => {
    mockedRequest.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
      if (path === '/v1/me/preferences') return { preferences: {} }
      if (path.includes('/v1/me/preferences/') && init?.method === 'PUT') {
        return { ok: true }
      }
      throw new Error(`unexpected ${path}`)
    })

    const { result, unmount } = renderHook(() => usePreference<string>('ui.interaction_mode', ''), {
      wrapper: wrap(),
    })

    await act(async () => {
      result.current[1]('client')
    })
    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith(
        '/v1/me/preferences/ui.interaction_mode',
        expect.objectContaining({ method: 'PUT', body: { value: 'client' } }),
      )
    })
    expect(result.current[0]).toBe('client')
    unmount()

    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/v1/me/preferences') return { preferences: { 'ui.interaction_mode': 'client' } }
      throw new Error(`unexpected ${path}`)
    })

    const remount = renderHook(() => usePreference<string>('ui.interaction_mode', ''), { wrapper: wrap() })
    await waitFor(() => expect(remount.result.current[0]).toBe('client'))
  })

  it('rolls back and toasts on PUT error', async () => {
    mockedRequest.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/v1/me/preferences') return { preferences: { 'ui.interaction_mode': 'master' } }
      if (init?.method === 'PUT') throw Object.assign(new Error('fail'), { status: 500 })
      throw new Error(`unexpected ${path}`)
    })

    const { result } = renderHook(() => usePreference<string>('ui.interaction_mode', ''), {
      wrapper: wrap(),
    })
    await waitFor(() => expect(result.current[0]).toBe('master'))

    await act(async () => {
      result.current[1]('client')
    })

    await waitFor(() => {
      expect(result.current[0]).toBe('master')
      expect(toastError).toHaveBeenCalledWith(
        expect.stringMatching(/Не удалось сохранить/),
      )
    })
  })

  it('ignores stale PUT failure after a newer successful toggle', async () => {
    let resolveFirst!: (v: unknown) => void
    let resolveSecond!: (v: unknown) => void
    const first = new Promise((r) => {
      resolveFirst = r
    })
    const second = new Promise((r) => {
      resolveSecond = r
    })
    let putCount = 0

    mockedRequest.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
      if (path === '/v1/me/preferences') return { preferences: { 'ui.interaction_mode': 'master' } }
      if (options?.method === 'PUT') {
        putCount += 1
        const n = putCount
        if (n === 1) {
          await first
          throw Object.assign(new Error('stale fail'), { status: 500 })
        }
        await second
        return { ok: true }
      }
      throw new Error(`unexpected ${path}`)
    })

    const { result } = renderHook(() => usePreference<string>('ui.interaction_mode', ''), {
      wrapper: wrap(),
    })
    await waitFor(() => expect(result.current[0]).toBe('master'))

    await act(async () => {
      result.current[1]('client')
      result.current[1]('master')
    })
    expect(result.current[0]).toBe('master')

    await act(async () => {
      resolveSecond({ ok: true })
      await second
    })
    await act(async () => {
      resolveFirst(undefined)
      await first.catch(() => undefined)
    })

    await waitFor(() => {
      expect(result.current[0]).toBe('master')
    })
    // Stale failure must not toast after newer request won.
    expect(toastError).not.toHaveBeenCalled()
  })
})
