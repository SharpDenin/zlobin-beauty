import { describe, expect, it } from 'vitest'
import { browserSupportsWebPush, urlBase64ToUint8Array } from '@/features/pwa/push'

describe('push helpers', () => {
  it('decodes VAPID applicationServerKey from url-safe base64', () => {
    const bytes = urlBase64ToUint8Array('AQID')
    expect(Array.from(bytes)).toEqual([1, 2, 3])
  })

  it('reports support based on browser APIs', () => {
    expect(typeof browserSupportsWebPush()).toBe('boolean')
  })
})
