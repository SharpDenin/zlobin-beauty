import { createContext, useContext, useMemo, useState, useEffect, useRef, type ReactNode } from 'react'
import { apiRequest, bindAuthBridge } from '@/shared/api/client'

export type User = {
  id: string
  email: string | null
  phone: string | null
  display_name: string
  city: string
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
  login: (email: string, password: string) => Promise<User>
  register: (input: {
    email: string
    password: string
    display_name: string
    as_master?: boolean
    as_supplier?: boolean
  }) => Promise<User>
  logout: () => Promise<void>
  updateUser: (user: User) => void
}

const STORAGE_KEY = 'zb.auth'

const AuthContext = createContext<AuthState | null>(null)

function loadStored(): { accessToken: string; refreshToken: string; user: User } | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as { accessToken: string; refreshToken: string; user: User }
  } catch {
    return null
  }
}

export function hasMasterAccess(user: User | null | undefined): boolean {
  if (!user) return false
  return user.roles.some((r) => r === 'master' || r === 'salon_owner' || r === 'system_admin')
}

export function hasSupplierAccess(user: User | null | undefined): boolean {
  if (!user) return false
  return user.roles.some((r) => r === 'supplier' || r === 'system_admin')
}

export function hasSystemAdmin(user: User | null | undefined): boolean {
  if (!user) return false
  return user.roles.includes('system_admin')
}

/** Default landing path after login/register by primary role. Master wins over supplier. */
export function homePathForUser(user: User | null | undefined): string {
  if (!user) return '/'
  if (hasMasterAccess(user)) return '/'
  if (hasSupplierAccess(user)) return '/supplier'
  return '/'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const stored = loadStored()
  const [user, setUser] = useState<User | null>(stored?.user ?? null)
  const [accessToken, setAccessToken] = useState<string | null>(stored?.accessToken ?? null)
  const [refreshToken, setRefreshToken] = useState<string | null>(stored?.refreshToken ?? null)
  const [loading, setLoading] = useState(Boolean(stored?.accessToken))
  const sessionRef = useRef({ accessToken, refreshToken, user })

  useEffect(() => {
    sessionRef.current = { accessToken, refreshToken, user }
  }, [accessToken, refreshToken, user])

  useEffect(() => {
    bindAuthBridge({
      getSession: () => {
        const s = sessionRef.current
        if (!s.accessToken || !s.refreshToken) return null
        return { accessToken: s.accessToken, refreshToken: s.refreshToken }
      },
      setSession: (next) => {
        if (next.user) setUser(next.user as User)
        setAccessToken(next.accessToken)
        setRefreshToken(next.refreshToken)
        const u = (next.user as User | undefined) ?? sessionRef.current.user
        if (u) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({
            accessToken: next.accessToken,
            refreshToken: next.refreshToken,
            user: u,
          }))
        }
      },
      clearSession: () => {
        setUser(null)
        setAccessToken(null)
        setRefreshToken(null)
        localStorage.removeItem(STORAGE_KEY)
      },
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    async function hydrate() {
      const snap = loadStored()
      if (!snap?.accessToken) {
        setLoading(false)
        return
      }
      try {
        const me = await apiRequest<User>('/v1/auth/me', { token: snap.accessToken, skipAuthRefresh: true })
        if (!cancelled) {
          setUser(me)
          setAccessToken(snap.accessToken)
          setRefreshToken(snap.refreshToken)
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...snap, user: me }))
        }
      } catch {
        try {
          const next = await apiRequest<AuthResponse>('/v1/auth/refresh', {
            body: { refresh_token: snap.refreshToken },
            skipAuthRefresh: true,
          })
          if (!cancelled) applyAuth(next)
        } catch {
          if (!cancelled) clear()
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

  function applyAuth(res: AuthResponse) {
    setUser(res.user)
    setAccessToken(res.access_token)
    setRefreshToken(res.refresh_token)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      accessToken: res.access_token,
      refreshToken: res.refresh_token,
      user: res.user,
    }))
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
      const res = await apiRequest<AuthResponse>('/v1/auth/login', {
        body: { email, password },
        skipAuthRefresh: true,
      })
      applyAuth(res)
      return res.user
    },
    async register(input) {
      const res = await apiRequest<AuthResponse>('/v1/auth/register', {
        body: input,
        skipAuthRefresh: true,
      })
      applyAuth(res)
      return res.user
    },
    async logout() {
      if (refreshToken) {
        try {
          await apiRequest('/v1/auth/logout', {
            body: { refresh_token: refreshToken },
            skipAuthRefresh: true,
          })
        } catch {
          // local clear still required
        }
      }
      clear()
    },
    updateUser(next) {
      setUser(next)
      const snap = sessionRef.current
      if (snap.accessToken && snap.refreshToken) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          accessToken: snap.accessToken,
          refreshToken: snap.refreshToken,
          user: next,
        }))
      }
    },
  }), [user, accessToken, refreshToken, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('AuthProvider missing')
  return ctx
}
