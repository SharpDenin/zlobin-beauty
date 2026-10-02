import { logAppError, payloadFromResponse } from '@/shared/lib/app-error'
import { isTokenFresh, readStoredSession, type SessionEndReason } from '@/features/auth/session-storage'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

export class ApiError extends Error {
  code: string
  status: number
  details?: Record<string, unknown>
  requestId?: string
  technicalMessage?: string

  constructor(
    message: string,
    code: string,
    status: number,
    extra?: { details?: Record<string, unknown>; requestId?: string; technicalMessage?: string },
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = extra?.details
    this.requestId = extra?.requestId
    this.technicalMessage = extra?.technicalMessage
  }
}

export function apiErrorFromResponse(data: unknown, status: number): ApiError {
  const payload = payloadFromResponse(data, status)
  const err = new ApiError(payload.message, payload.code, payload.status, {
    details: payload.details,
    requestId: payload.requestId,
    technicalMessage: payload.technicalMessage,
  })
  logAppError(err, 'api')
  return err
}

export function networkApiError(cause?: unknown): ApiError {
  const payload = payloadFromResponse({ error: { code: 'network_error', message: 'network error' } }, 0)
  const err = new ApiError(payload.message, 'network_error', 0, {
    technicalMessage: cause instanceof Error ? cause.message : 'network error',
  })
  logAppError(err, 'network')
  return err
}

function abortedApiError(): ApiError {
  return new ApiError('aborted', 'aborted', 0, { technicalMessage: 'request aborted' })
}

type RequestOptions = {
  method?: string
  body?: unknown
  token?: string | null
  skipAuthRefresh?: boolean
  headers?: Record<string, string>
  idempotencyKey?: string
  signal?: AbortSignal
}

type SessionSnapshot = {
  accessToken: string
  refreshToken: string
}

type AuthBridge = {
  getSession: () => SessionSnapshot | null
  /** `persist: false` is used when adopting a pair another tab already stored. */
  setSession: (next: SessionSnapshot & { user?: unknown }, persist?: boolean) => void
  clearSession: (reason: SessionEndReason) => void
}

let authBridge: AuthBridge | null = null
let refreshInFlight: Promise<string | null> | null = null
/** Aborted when the session ends so zombie requests cannot trigger refresh/redirect storms. */
let sessionAbort = new AbortController()

export function bindAuthBridge(bridge: AuthBridge) {
  authBridge = bridge
}

/** Cancels every in-flight request made through this client (called on logout / session end). */
export function abortInFlightRequests() {
  sessionAbort.abort()
  sessionAbort = new AbortController()
}

const PUBLIC_AUTH_PATHS = ['/v1/auth/login', '/v1/auth/register', '/v1/auth/refresh', '/v1/auth/logout']

function isPublicAuthPath(path: string) {
  return PUBLIC_AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}?`))
}

async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined
  if (locks?.request) {
    // Serialises refreshes across tabs: a refresh token is single-use (rotating).
    return (await locks.request('zb-auth-refresh', fn)) as T
  }
  return fn()
}

/**
 * Exchange the refresh token for a new pair. Safe to call concurrently: one network call per tab
 * (single flight) and one per browser (Web Locks), and a pair another tab already stored is adopted
 * instead of refreshing again. Returns null when there is no session or it could not be renewed.
 * Only a definitive 401/403 from the server ends the session as `expired`.
 */
export function refreshAccessToken(rejectedToken?: string): Promise<string | null> {
  if (!authBridge) return Promise.resolve(null)
  if (refreshInFlight) return refreshInFlight
  const bridge = authBridge

  const run = async (): Promise<string | null> => {
    const mem = bridge.getSession()
    const stored = readStoredSession()
    // `rejectedToken`: the server refused this token even though it looks unexpired (revoked,
    // clock skew): it must not be reused as the "already renewed" shortcut.
    const usable = (t: string | null | undefined) => Boolean(t) && isTokenFresh(t) && t !== rejectedToken

    // A sibling tab (or the previous lock holder) may already have renewed the pair.
    if (stored && usable(stored.accessToken) && stored.accessToken !== mem?.accessToken) {
      bridge.setSession({ accessToken: stored.accessToken, refreshToken: stored.refreshToken }, false)
      return stored.accessToken
    }
    if (mem && usable(mem.accessToken)) return mem.accessToken

    const refreshToken = stored?.refreshToken ?? mem?.refreshToken
    if (!refreshToken) return null // nothing to renew (e.g. already signed out): never an "expired" event

    let res: Response
    try {
      res = await fetch(`${API_BASE_URL}/v1/auth/refresh`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
    } catch (cause) {
      throw networkApiError(cause)
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        // Lost a race with another tab that rotated the token a moment ago? Adopt its pair.
        const latest = readStoredSession()
        if (latest && latest.refreshToken !== refreshToken) {
          bridge.setSession({ accessToken: latest.accessToken, refreshToken: latest.refreshToken }, false)
          return latest.accessToken
        }
        bridge.clearSession('expired')
      }
      return null
    }
    bridge.setSession({ accessToken: data.access_token, refreshToken: data.refresh_token, user: data.user })
    return data.access_token as string
  }

  refreshInFlight = withRefreshLock(run).finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}

/** Returns an access token that is valid right now, refreshing first when it is about to expire. */
export async function getFreshAccessToken(): Promise<string | null> {
  const session = authBridge?.getSession()
  if (!session) return null
  if (isTokenFresh(session.accessToken)) return session.accessToken
  try {
    return (await refreshAccessToken()) ?? null
  } catch {
    // Offline / gateway down: keep the stored access token so hydrate can stay signed-in.
    return session.accessToken
  }
}

/**
 * fetch() for non-JSON resources (media bytes, downloads) with the same auth behaviour as
 * apiRequest: fresh token first, one refresh+retry on 401.
 */
export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const run = (token: string | null) =>
    fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
  const token = await getFreshAccessToken()
  let res = await run(token)
  if (res.status === 401 && authBridge?.getSession()) {
    let next: string | null = null
    try {
      next = await refreshAccessToken(token ?? undefined)
    } catch {
      next = null
    }
    if (next && next !== token) res = await run(next)
  }
  return res
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const isPublic = isPublicAuthPath(path)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers ?? {}),
  }
  if (options.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey
  }

  let token: string | null | undefined = options.token
  if (!isPublic) {
    if (!options.skipAuthRefresh && authBridge) {
      // Components often hold an older token in React state; always prefer the live session's token
      // and renew it before it expires instead of sending a request that is bound to fail.
      const live = authBridge.getSession()
      if (live && (token === undefined || token === null || token === live.accessToken || !isTokenFresh(token))) {
        token = await getFreshAccessToken()
      }
    } else if (token === undefined && authBridge) {
      token = authBridge.getSession()?.accessToken ?? null
    }
    if (token) headers.Authorization = `Bearer ${token}`
  }

  const signal = options.signal ?? sessionAbort.signal
  const doFetch = () =>
    fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal,
    })

  let res: Response
  try {
    res = await doFetch()
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw abortedApiError()
    throw networkApiError(cause)
  }

  if (res.status === 401 && !options.skipAuthRefresh && !isPublic && authBridge?.getSession()) {
    let next: string | null = null
    try {
      next = await refreshAccessToken(token ?? undefined)
    } catch (cause) {
      throw cause instanceof ApiError && cause.code === 'network_error' ? cause : networkApiError(cause)
    }
    if (next && next !== token) {
      headers.Authorization = `Bearer ${next}`
      try {
        res = await doFetch()
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') throw abortedApiError()
        throw networkApiError(cause)
      }
    }
  }

  if (res.status === 204) {
    return undefined as T
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw apiErrorFromResponse(data, res.status)
  }
  return data as T
}
