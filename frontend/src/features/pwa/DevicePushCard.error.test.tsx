import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DevicePushCard } from './DevicePushCard'

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ accessToken: 'tok', user: { id: 'u1' } }),
}))

vi.mock('@/shared/lib/preferences', () => ({
  usePreference: () => [{ declined: false }, vi.fn()],
}))

vi.mock('@/features/pwa/push', () => ({
  fetchPushConfig: vi.fn(async () => {
    throw new Error('network down')
  }),
  syncDevicePush: vi.fn(async () => false),
  resolveDevicePushStatus: vi.fn(async () => 'error'),
  enableDevicePush: vi.fn(async () => undefined),
  disableDevicePush: vi.fn(async () => undefined),
}))

describe('DevicePushCard config failure', () => {
  afterEach(() => cleanup())

  it('leaves infinite checking and shows a terminal error state', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={qc}>
        <DevicePushCard />
      </QueryClientProvider>,
    )
    await waitFor(
      () => {
        expect(screen.getByTestId('device-push-status').textContent).not.toMatch(/Проверяем/)
      },
      { timeout: 5_000 },
    )
    expect(screen.getByTestId('device-push-status')).toHaveTextContent(/Не удалось проверить Push/i)
    expect(screen.getByTestId('device-push-enable')).toBeInTheDocument()
  })
})
