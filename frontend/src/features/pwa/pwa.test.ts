import { describe, expect, it } from 'vitest'
import { isChunkLoadFailure, shouldOfferInstall } from './pwa'

describe('PWA helpers', () => {
  it('offers install only when the browser can prompt and the user has not dismissed', () => {
    expect(shouldOfferInstall({ standalone: false, hasPrompt: true, dismissed: false, iOS: false })).toBe(true)
    expect(shouldOfferInstall({ standalone: true, hasPrompt: true, dismissed: false, iOS: false })).toBe(false)
    expect(shouldOfferInstall({ standalone: false, hasPrompt: true, dismissed: true, iOS: false })).toBe(false)
    expect(shouldOfferInstall({ standalone: false, hasPrompt: false, dismissed: false, iOS: false })).toBe(false)
    expect(shouldOfferInstall({ standalone: false, hasPrompt: true, dismissed: false, iOS: true })).toBe(false)
  })

  it('detects stale chunk failures without exposing stack text to callers', () => {
    expect(isChunkLoadFailure(new Error('Failed to fetch dynamically imported module'))).toBe(true)
    expect(isChunkLoadFailure(new Error('TypeError: cannot read properties of undefined'))).toBe(false)
  })
})
