/**
 * Block iOS Safari pinch/gesture zoom without swallowing pan/scroll/tap.
 * Complements viewport maximum-scale=1 / user-scalable=no.
 */
export function installPinchZoomGuard(): () => void {
  if (typeof document === 'undefined') return () => undefined

  const blockGesture = (event: Event) => {
    event.preventDefault()
  }

  // Safari multi-finger zoom gestures (not fired for single-finger scroll).
  document.addEventListener('gesturestart', blockGesture, { passive: false })
  document.addEventListener('gesturechange', blockGesture, { passive: false })
  document.addEventListener('gestureend', blockGesture, { passive: false })

  return () => {
    document.removeEventListener('gesturestart', blockGesture)
    document.removeEventListener('gesturechange', blockGesture)
    document.removeEventListener('gestureend', blockGesture)
  }
}
