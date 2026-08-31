export const INSTALL_DISMISS_KEY = 'zb.pwa-install-dismissed'
export const SESSION_ENDED_KEY = 'zb.session-ended'

export function shouldOfferInstall(opts: {
  standalone: boolean
  hasPrompt: boolean
  dismissed: boolean
  iOS: boolean
}) {
  if (opts.standalone || opts.dismissed || opts.iOS) return false
  return opts.hasPrompt
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  const mq = window.matchMedia?.('(display-mode: standalone)')
  return Boolean(mq?.matches) || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function isIosBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as Window & { MSStream?: unknown }).MSStream
}

export function markInstallDismissed() {
  try {
    localStorage.setItem(INSTALL_DISMISS_KEY, '1')
  } catch {
    /* ignore quota */
  }
}

export function installWasDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export function markSessionEnded() {
  try {
    sessionStorage.setItem(SESSION_ENDED_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function consumeSessionEnded(): boolean {
  try {
    if (sessionStorage.getItem(SESSION_ENDED_KEY) !== '1') return false
    sessionStorage.removeItem(SESSION_ENDED_KEY)
    return true
  } catch {
    return false
  }
}

export function isChunkLoadFailure(error: unknown): boolean {
  const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '')
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(msg)
}
