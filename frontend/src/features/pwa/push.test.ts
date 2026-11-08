import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  browserSupportsWebPush,
  clearRememberedVapidPublicKey,
  rememberVapidPublicKey,
  rememberedVapidPublicKey,
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
