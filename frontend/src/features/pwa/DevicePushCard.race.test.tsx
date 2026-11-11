import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DevicePushCard } from './DevicePushCard'

const authState = {
  accessToken: 'tok-a' as string | null,
  user: { id: 'user-a', display_name: 'A' } as { id: string; display_name: string } | null,
}

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ accessToken: authState.accessToken, user: authState.user }),
}))

vi.mock('@/shared/lib/preferences', () => ({
  usePreference: () => [{ declined: false }, vi.fn()],
}))

type PushUi =
  | 'loading'
  | 'unsupported'
  | 'server_disabled'
  | 'denied'
  | 'default'
  | 'subscribed'
  | 'ready'
  | 'error'

const syncDevicePush = vi.fn(async (_token?: string | null, _publicKey?: string) => false)
const resolveDevicePushStatus = vi.fn(
  async (_config?: unknown, _opts?: { serverSynced?: boolean }): Promise<PushUi> => 'default',
)
const fetchPushConfig = vi.fn(async (_token?: string | null, _signal?: AbortSignal) => ({
  enabled: true,
  public_key: 'B'.repeat(80),
}))

vi.mock('@/features/pwa/push', () => ({
  fetchPushConfig: (token: string | null, signal?: AbortSignal) => fetchPushConfig(token, signal),
  syncDevicePush: (token: string | null, publicKey?: string) => syncDevicePush(token, publicKey),
  resolveDevicePushStatus: (
    config: { enabled: boolean; public_key: string } | null | undefined,
    opts?: { serverSynced?: boolean },
  ) => resolveDevicePushStatus(config, opts),
  enableDevicePush: vi.fn(async () => undefined),
  disableDevicePush: vi.fn(async () => undefined),
}))

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('DevicePushCard races and finite states', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    authState.accessToken = 'tok-a'
    authState.user = { id: 'user-a', display_name: 'A' }
    syncDevicePush.mockReset()
    resolveDevicePushStatus.mockReset()
    fetchPushConfig.mockReset()
    fetchPushConfig.mockResolvedValue({ enabled: true, public_key: 'B'.repeat(80) })
    resolveDevicePushStatus.mockResolvedValue('default')
    syncDevicePush.mockResolvedValue(false)
  })

  it('hanging syncDevicePush still leaves checking via wall-clock error', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    syncDevicePush.mockImplementation(() => new Promise(() => undefined))
    wrap(<DevicePushCard />)
    await waitFor(() => expect(screen.getByTestId('device-push-status').textContent).toMatch(/Проверяем/))
    await vi.advanceTimersByTimeAsync(13_000)
    await waitFor(() => {
      expect(screen.getByTestId('device-push-status').textContent).not.toMatch(/Проверяем/)
      expect(screen.getByTestId('device-push-status').textContent).toMatch(/Не удалось проверить Push/)
    })
    vi.useRealTimers()
  })

  it('stale check from user A cannot overwrite user B status', async () => {
    const stale: { resolve?: (value: boolean) => void } = {}
    syncDevicePush.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          stale.resolve = resolve
        }),
    )
    resolveDevicePushStatus.mockImplementation(async (_c, opts?: { serverSynced?: boolean }) =>
      opts?.serverSynced ? 'subscribed' : 'default',
    )

    const { rerender } = wrap(<DevicePushCard />)
    await waitFor(() => expect(syncDevicePush).toHaveBeenCalled())

    authState.user = { id: 'user-b', display_name: 'B' }
    authState.accessToken = 'tok-b'
    syncDevicePush.mockResolvedValue(false)
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DevicePushCard />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('device-push-status').textContent).not.toMatch(/Проверяем/))
    const statusForB = screen.getByTestId('device-push-status').textContent

    if (!stale.resolve) throw new Error('stale sync gate missing')
    stale.resolve(true)
    await Promise.resolve()
    expect(screen.getByTestId('device-push-status').textContent).toBe(statusForB)
    expect(screen.getByTestId('device-push-status').textContent).not.toMatch(/включены/i)
  })

  it('retry after error re-enables enable button path', async () => {
    fetchPushConfig.mockRejectedValueOnce(new Error('down'))
    wrap(<DevicePushCard />)
    await waitFor(() => expect(screen.getByTestId('device-push-enable')).toBeInTheDocument())
    expect(screen.getByTestId('device-push-status').textContent).toMatch(/Не удалось проверить Push/)
    fireEvent.click(screen.getByTestId('device-push-enable'))
    // enable mutation uses enableDevicePush mock — card stays interactive after error.
    expect(screen.getByTestId('device-push-enable')).toBeInTheDocument()
  })

  it('logout clears to error and does not keep subscribed copy', async () => {
    resolveDevicePushStatus.mockResolvedValue('subscribed')
    syncDevicePush.mockResolvedValue(true)
    const view = wrap(<DevicePushCard />)
    await waitFor(() => expect(screen.getByTestId('device-push-status').textContent).toMatch(/включены/i))

    authState.accessToken = null
    authState.user = null
    view.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DevicePushCard />
      </QueryClientProvider>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('device-push-status').textContent).toMatch(/Не удалось проверить Push/)
    })
  })
})
