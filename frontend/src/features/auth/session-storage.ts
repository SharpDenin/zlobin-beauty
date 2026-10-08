/**
 * Persisted auth session (localStorage) shared by the API client and AuthProvider.
 * Kept free of React/network imports so both can depend on it without cycles.
 */

export const SESSION_STORAGE_KEY = 'zb.auth'

export type StoredSession = {
  accessToken: string
  refreshToken: string
  user?: unknown
}

/** Why a session ended. Only `expired` may show a (soft) message on the login screen. */
export type SessionEndReason = 'expired' | 'logout' | 'replaced'

export function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredSession> | null
    if (!parsed || typeof parsed.accessToken !== 'string' || typeof parsed.refreshToken !== 'string') return null
    return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken, user: parsed.user }
  } catch {
    return null
  }
}

export function writeStoredSession(session: StoredSession) {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
  } catch {
    /* storage unavailable (private mode quota): the in-memory session still works for this tab */
  }
}

export function clearStoredSession() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** Expiry of a JWT in epoch ms, or null when it cannot be decoded (treated as stale by callers). */
export function jwtExpiryMs(token: string | null | undefined): number | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='))
        .split('')
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    )
    const exp = (JSON.parse(json) as { exp?: unknown }).exp
    return typeof exp === 'number' ? exp * 1000 : null
  } catch {
    return null
  }
}

/** True when the access token is still valid for at least `skewMs` (clock skew + request time). */
export function isTokenFresh(token: string | null | undefined, skewMs = 45_000, now = Date.now()): boolean {
  const exp = jwtExpiryMs(token)
  return exp != null && exp - now > skewMs
}
