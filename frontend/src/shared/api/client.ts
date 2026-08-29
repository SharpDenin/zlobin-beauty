import { logAppError, payloadFromResponse } from '@/shared/lib/app-error'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? '' : 'http://localhost:8090')

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

type RequestOptions = {
  method?: string
  body?: unknown
  token?: string | null
  skipAuthRefresh?: boolean
  headers?: Record<string, string>
  idempotencyKey?: string
}

type SessionSnapshot = {
  accessToken: string
  refreshToken: string
}

type AuthBridge = {
  getSession: () => SessionSnapshot | null
  setSession: (next: SessionSnapshot & { user?: unknown }) => void
  clearSession: () => void
}

let authBridge: AuthBridge | null = null
let refreshInFlight: Promise<string | null> | null = null

export function bindAuthBridge(bridge: AuthBridge) {
  authBridge = bridge
}

async function refreshAccessToken(): Promise<string | null> {
  if (!authBridge) return null
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    const session = authBridge!.getSession()
    if (!session?.refreshToken) {
      authBridge!.clearSession()
      return null
    }
    try {
      const res = await fetch(`${API_BASE_URL}/v1/auth/refresh`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refreshToken }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        authBridge!.clearSession()
        return null
      }
      authBridge!.setSession({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        user: data.user,
      })
      return data.access_token as string
    } catch {
      authBridge!.clearSession()
      return null
    } finally {
      refreshInFlight = null
    }
  })()

  return refreshInFlight
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
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

  let token = options.token
  if (token === undefined && authBridge) {
    token = authBridge.getSession()?.accessToken ?? null
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const doFetch = () =>
    fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })

  let res: Response
  try {
    res = await doFetch()
  } catch (cause) {
    throw networkApiError(cause)
  }

  if (res.status === 401 && !options.skipAuthRefresh && !path.startsWith('/v1/auth/login') && !path.startsWith('/v1/auth/register') && !path.startsWith('/v1/auth/refresh')) {
    const next = await refreshAccessToken()
    if (next) {
      headers.Authorization = `Bearer ${next}`
      try {
        res = await doFetch()
      } catch (cause) {
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
