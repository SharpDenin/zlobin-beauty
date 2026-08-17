export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8090'

export class ApiError extends Error {
  code: string
  status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
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

  let res = await doFetch()

  if (res.status === 401 && !options.skipAuthRefresh && !path.startsWith('/v1/auth/login') && !path.startsWith('/v1/auth/register') && !path.startsWith('/v1/auth/refresh')) {
    const next = await refreshAccessToken()
    if (next) {
      headers.Authorization = `Bearer ${next}`
      res = await doFetch()
    }
  }

  if (res.status === 204) {
    return undefined as T
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = data?.error
    throw new ApiError(
      humanizeError(err?.message, res.status),
      err?.code ?? 'error',
      res.status,
    )
  }
  return data as T
}

function humanizeError(message: unknown, status: number): string {
  if (typeof message === 'string' && message.trim()) {
    const known: Record<string, string> = {
      'invalid credentials': 'Неверный email или пароль',
      'email already registered': 'Этот email уже зарегистрирован',
      'time slot is not available': 'Это время уже занято',
      'selected time is not available': 'На это время уже запланировано другое событие',
      'planner block overlaps another event': 'На это время уже запланировано другое событие',
      'planner block overlaps an appointment': 'На это время уже запланировано другое событие',
      'planner block is outside working hours': 'Это время вне рабочих часов',
      'invalid appointment status transition': 'Это действие недоступно для текущего статуса записи',
      'occurrence overlaps': 'Окно пересекается с другим сеансом',
      'occurrence is full': 'Мест на этот сеанс больше нет',
      'occurrence is not bookable': 'Этот сеанс недоступен для записи',
      unauthorized: 'Требуется вход в аккаунт',
      forbidden: 'Недостаточно прав',
    }
    const lower = message.toLowerCase()
    for (const [k, v] of Object.entries(known)) {
      if (lower.includes(k)) return v
    }
    return message
  }
  if (status === 401) return 'Сеанс истёк. Войдите снова'
  if (status === 403) return 'Недостаточно прав для этого действия'
  if (status === 404) return 'Объект не найден'
  if (status === 409) return 'Конфликт данных. Обновите страницу и попробуйте снова'
  if (status >= 500) return 'Сервис временно недоступен. Попробуйте позже'
  return 'Не удалось выполнить запрос'
}
