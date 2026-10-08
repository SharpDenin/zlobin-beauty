import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acquireOverlayLock,
  isOverlayLocked,
  overlayEscapeDepth,
  overlayLockCount,
  registerOverlayEscape,
  releaseOrphanedOverlayLock,
  resetOverlayLockForTests,
} from '@/shared/ui/overlayLock'

afterEach(() => {
  resetOverlayLockForTests()
  vi.restoreAllMocks()
})

describe('overlay scroll lock', () => {
  it('locks body on open and restores scroll position on close', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation((...args: unknown[]) => {
      const y = typeof args[0] === 'number' ? args[1] : (args[0] as { top?: number })?.top
      if (typeof y === 'number') Object.defineProperty(window, 'scrollY', { value: y, configurable: true })
    })
    Object.defineProperty(window, 'scrollY', { value: 1432, configurable: true })

    const release = acquireOverlayLock()
    expect(overlayLockCount()).toBe(1)
    expect(isOverlayLocked()).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.body.style.position).toBe('fixed')
    expect(document.body.style.top).toBe('-1432px')
    expect(document.body.classList.contains('is-overlay-locked')).toBe(true)

    release()
    expect(overlayLockCount()).toBe(0)
    expect(isOverlayLocked()).toBe(false)
    expect(document.body.style.overflow).toBe('')
    expect(document.body.style.position).toBe('')
    expect(document.body.style.top).toBe('')
    expect(document.body.classList.contains('is-overlay-locked')).toBe(false)
    expect(scrollTo).toHaveBeenCalled()
    expect(window.scrollY).toBe(1432)
  })

  it('keeps lock while nested overlays are open', () => {
    Object.defineProperty(window, 'scrollY', { value: 80, configurable: true })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

    const outer = acquireOverlayLock()
    const inner = acquireOverlayLock()
    expect(overlayLockCount()).toBe(2)
    expect(document.body.style.position).toBe('fixed')

    inner()
    expect(overlayLockCount()).toBe(1)
    expect(isOverlayLocked()).toBe(true)
    expect(document.body.style.position).toBe('fixed')

    outer()
    expect(overlayLockCount()).toBe(0)
    expect(document.body.style.position).toBe('')
  })

  it('does not unlock if release is called twice', () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    const release = acquireOverlayLock()
    release()
    release()
    expect(overlayLockCount()).toBe(0)
  })

  it('releases orphaned locks when no overlay remains in the DOM', () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    acquireOverlayLock()
    expect(isOverlayLocked()).toBe(true)
    releaseOrphanedOverlayLock()
    expect(overlayLockCount()).toBe(0)
    expect(isOverlayLocked()).toBe(false)
    expect(document.body.classList.contains('is-overlay-locked')).toBe(false)
  })
})

describe('overlay escape stack', () => {
  it('closes only the top overlay', () => {
    const inner = vi.fn()
    const outer = vi.fn()
    const releaseOuter = registerOverlayEscape(outer)
    const releaseInner = registerOverlayEscape(inner)
    expect(overlayEscapeDepth()).toBe(2)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()

    releaseInner()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(outer).toHaveBeenCalledTimes(1)

    releaseOuter()
    expect(overlayEscapeDepth()).toBe(0)
  })

  it('does not close while IME is composing', () => {
    const onClose = vi.fn()
    registerOverlayEscape(onClose)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true }))
    expect(onClose).not.toHaveBeenCalled()
  })
})
