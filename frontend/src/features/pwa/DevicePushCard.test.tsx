import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DevicePushCard } from './DevicePushCard'

const setOnboarding = vi.fn()
let onboarding = { declined: false }

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ accessToken: 'tok', user: { id: 'u1' } }),
}))

vi.mock('@/shared/lib/preferences', () => ({
  usePreference: () => [onboarding, setOnboarding],
}))

vi.mock('@/features/pwa/push', () => ({
  fetchPushConfig: vi.fn(async () => ({ enabled: true, public_key: 'B'.repeat(80) })),
  syncDevicePush: vi.fn(async () => false),
  resolveDevicePushStatus: vi.fn(async (_config?: unknown, opts?: { serverSynced?: boolean }) => {
    if (opts?.serverSynced === true) return 'subscribed'
    return 'default'
  }),
  enableDevicePush: vi.fn(async () => undefined),
  disableDevicePush: vi.fn(async () => undefined),
}))

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('DevicePushCard homePrompt', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    onboarding = { declined: false }
    setOnboarding.mockClear()
  })

  it('shows enable and decline on home, and decline hides the card', async () => {
    wrap(<DevicePushCard homePrompt compact />)
    await waitFor(() => expect(screen.getByTestId('device-push-enable')).toBeInTheDocument())
    expect(screen.getByTestId('device-push-decline')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('device-push-decline'))
    expect(setOnboarding).toHaveBeenCalledWith({ declined: true })

    cleanup()
    onboarding = { declined: true }
    wrap(<DevicePushCard homePrompt compact />)
    await waitFor(() => expect(screen.queryByTestId('device-push-card')).toBeNull())
  })

  it('keeps the settings card visible after a prior decline', async () => {
    onboarding = { declined: true }
    wrap(<DevicePushCard />)
    await waitFor(() => expect(screen.getByTestId('device-push-enable')).toBeInTheDocument())
    expect(screen.getByTestId('device-push-card')).toBeInTheDocument()
  })
})
