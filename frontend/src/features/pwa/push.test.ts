import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  browserSupportsWebPush,
  clearRememberedVapidPublicKey,
  rememberVapidPublicKey,
  rememberedVapidPublicKey,
  resolveDevicePushStatus,
  urlBase64ToUint8Array,
  vapidPublicKeyChanged,
} from '@/features/pwa/push'

describe('push helpers', () => {
  beforeEach(() => {
    clearRememberedVapidPublicKey()
  })

  it('decodes VAPID applicationServerKey from url-safe base64', () => {
    const bytes = urlBase64ToUint8Array('AQID')
    expect(Array.from(bytes)).toEqual([1, 2, 3])
  })

  it('reports support based on browser APIs', () => {
    expect(typeof browserSupportsWebPush()).toBe('boolean')
  })

  it('detects VAPID public key rotation via remembered key', () => {
    expect(vapidPublicKeyChanged('new-key')).toBe(false)
    rememberVapidPublicKey('old-key')
    expect(rememberedVapidPublicKey()).toBe('old-key')
    expect(vapidPublicKeyChanged('new-key')).toBe(true)
    expect(vapidPublicKeyChanged('old-key')).toBe(false)
  })

  it('clears remembered key', () => {
    rememberVapidPublicKey('k')
    clearRememberedVapidPublicKey()
    expect(rememberedVapidPublicKey()).toBeNull()
  })

  it('tolerates localStorage failures', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => rememberVapidPublicKey('k')).not.toThrow()
    spy.mockRestore()
  })
})

describe('resolveDevicePushStatus server sync gate', () => {
  const config = { enabled: true, public_key: 'BTESTPUBLICKEY' }

  beforeEach(() => {
    clearRememberedVapidPublicKey()
    rememberVapidPublicKey(config.public_key)
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { permission: 'granted' },
    })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: async () => ({ endpoint: 'https://push.example/x' }),
          },
        }),
      },
    })
    vi.stubGlobal('PushManager', function PushManager() {})
  })

  it('does not report subscribed without confirmed server sync', async () => {
    await expect(resolveDevicePushStatus(config)).resolves.toBe('ready')
    await expect(resolveDevicePushStatus(config, { serverSynced: false })).resolves.toBe('ready')
  })

  it('reports subscribed only after successful server sync', async () => {
    await expect(resolveDevicePushStatus(config, { serverSynced: true })).resolves.toBe('subscribed')
  })

  it('treats rotated VAPID key as ready even if sync flagged true', async () => {
    rememberVapidPublicKey('old-key')
    await expect(resolveDevicePushStatus(config, { serverSynced: true })).resolves.toBe('ready')
  })

  it('leaves loading when config is missing', async () => {
    await expect(resolveDevicePushStatus(null)).resolves.toBe('error')
    await expect(resolveDevicePushStatus(undefined)).resolves.toBe('error')
  })
})
