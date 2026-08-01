import { createContext, useContext, useMemo, useState, useEffect, type ReactNode } from 'react'
import { apiRequest } from '@/shared/api/client'

export type User = {
  id: string
  email: string | null
  phone: string | null
  display_name: string
  roles: string[]
  status: string
}

type AuthResponse = {
  access_token: string
  refresh_token: string
  access_expires_at: string
  refresh_expires_at: string
  user: User
}

type AuthState = {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (input: { email: string; password: string; display_name: string; as_master?: boolean }) => Promise<void>
  logout: () => Promise<void>
}

const STORAGE_KEY = 'zb.auth'

const AuthContext = createContext<AuthState | null>(null)

function loadStored(): { accessToken: string; refreshToken: string; user: User } | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const stored = loadStored()
  const [user, setUser] = useState<User | null>(stored?.user ?? null)
  const [accessToken, setAccessToken] = useState<string | null>(stored?.accessToken ?? null)
  const [refreshToken, setRefreshToken] = useState<string | null>(stored?.refreshToken ?? null)
  const [loading, setLoading] = useState(Boolean(stored?.accessToken))

  useEffect(() => {
    let cancelled = false
    async function hydrate() {
      if (!accessToken) {
        setLoading(false)
        return
      }
      try {
        const me = await apiRequest<User>('/v1/auth/me', { token: accessToken })
        if (!cancelled) {
          setUser(me)
          persist({ accessToken, refreshToken: refreshToken!, user: me })
        }
      } catch {
        if (refreshToken) {
          try {
            const next = await apiRequest<AuthResponse>('/v1/auth/refresh', {
              body: { refresh_token: refreshToken },
            })
            if (!cancelled) applyAuth(next)
          } catch {
            if (!cancelled) clear()
          }
        } else if (!cancelled) {
          clear()
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void hydrate()
    return () => {
      cancelled = true
    }
  }, [])

  function persist(next: { accessToken: string; refreshToken: string; user: User }) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  function applyAuth(res: AuthResponse) {
    setUser(res.user)
    setAccessToken(res.access_token)
    setRefreshToken(res.refresh_token)
    persist({ accessToken: res.access_token, refreshToken: res.refresh_token, user: res.user })
  }

  function clear() {
    setUser(null)
    setAccessToken(null)
    setRefreshToken(null)
    localStorage.removeItem(STORAGE_KEY)
  }

  const value = useMemo<AuthState>(() => ({
    user,
    accessToken,
    refreshToken,
    loading,
    async login(email, password) {
      const res = await apiRequest<AuthResponse>('/v1/auth/login', { body: { email, password } })
      applyAuth(res)
    },
    async register(input) {
      const res = await apiRequest<AuthResponse>('/v1/auth/register', { body: input })
      applyAuth(res)
    },
    async logout() {
      if (refreshToken) {
        try {
          await apiRequest('/v1/auth/logout', { body: { refresh_token: refreshToken } })
        } catch {
          // ignore network logout errors; local session still clears
        }
      }
      clear()
    },
  }), [user, accessToken, refreshToken, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('AuthProvider missing')
  return ctx
}
