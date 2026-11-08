import { afterEach, describe, expect, it, vi } from 'vitest'
import { installPinchZoomGuard } from '@/shared/lib/disablePinchZoom'

describe('installPinchZoomGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prevents Safari gesture zoom events and cleans up', () => {
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const uninstall = installPinchZoomGuard()
    expect(add).toHaveBeenCalledWith('gesturestart', expect.any(Function), { passive: false })
    expect(add).toHaveBeenCalledWith('gesturechange', expect.any(Function), { passive: false })
    expect(add).toHaveBeenCalledWith('gestureend', expect.any(Function), { passive: false })

    const handler = add.mock.calls.find((c) => c[0] === 'gesturestart')?.[1] as EventListener
    const event = new Event('gesturestart', { cancelable: true })
    const prevented = vi.spyOn(event, 'preventDefault')
    handler(event)
    expect(prevented).toHaveBeenCalled()

    uninstall()
    expect(remove).toHaveBeenCalledWith('gesturestart', handler)
  })
})
