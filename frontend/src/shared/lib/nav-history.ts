/** In-app history depth for compact Back — not a parallel history stack. */

let depth = 0
let lastKey: string | null = null
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

export function getNavHistoryDepth() {
  return depth
}

export function canGoBackInApp() {
  return depth > 0
}

export function trackNavHistory(type: 'PUSH' | 'POP' | 'REPLACE', locationKey: string) {
  // Dedupe Strict Mode double-effects and identical notifications.
  if (locationKey && locationKey === lastKey) return
  lastKey = locationKey || lastKey
  if (type === 'PUSH') depth += 1
  else if (type === 'POP') depth = Math.max(0, depth - 1)
  notify()
}

export function subscribeNavHistory(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test helper — not used in app code. */
export function resetNavHistoryForTests() {
  depth = 0
  lastKey = null
  notify()
}

/** Routes where a back control is not useful (primary chrome destinations). */
export const MAIN_NAV_PATHS = new Set([
  '/',
  '/calendar',
  '/appointments',
  '/messages',
  '/search',
  '/more',
  '/contacts',
  '/profile',
  '/notifications',
  '/shop',
  '/knowledge',
  '/admin',
  '/supplier',
  '/rep',
])

export function isMainNavPath(pathname: string) {
  if (MAIN_NAV_PATHS.has(pathname)) return true
  if (pathname === '/messages' || pathname.startsWith('/messages/')) {
    // Thread under messages still benefits from back; list does not.
    return pathname === '/messages'
  }
  return false
}
