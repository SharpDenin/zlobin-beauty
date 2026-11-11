import { afterEach, describe, expect, it, vi } from 'vitest'
import { getServiceWorkerRegistration, resolveDevicePushStatus } from './push'

describe('push readiness timeouts', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('getServiceWorkerRegistration times out when ready never settles', async () => {
    vi.useFakeTimers()
    const ready = new Promise<ServiceWorkerRegistration>(() => undefined)
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready },
    })
    Object.defineProperty(window, 'PushManager', {
      configurable: true,
      value: function PushManager() {},
    })
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { permission: 'default' },
    })

    const pending = getServiceWorkerRegistration(40)
    await vi.advanceTimersByTimeAsync(50)
    await expect(pending).resolves.toBeNull()
  })

  it('resolveDevicePushStatus never returns loading', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: { getSubscription: async () => null },
        }),
      },
    })
    Object.defineProperty(window, 'PushManager', {
      configurable: true,
      value: function PushManager() {},
    })
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { permission: 'default' },
    })
    const status = await resolveDevicePushStatus(
      { enabled: true, public_key: 'k' },
      { serverSynced: false },
    )
    expect(status).not.toBe('loading')
  })
})
