import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  abortInFlightRequests,
  apiRequest,
  bindAuthBridge,
  getFreshAccessToken,
  refreshAccessToken,
} from '@/shared/api/client'
import { queryClient } from '@/shared/api/query-client'
import { isUnauthorizedSessionError } from '@/features/auth/session-hydrate'
import {
  SESSION_STORAGE_KEY,
  clearStoredSession,
  jwtExpiryMs,
  readStoredSession,
  writeStoredSession,
  type SessionEndReason,
} from '@/features/auth/session-storage'
import { clearSessionEnded, markSessionEnded } from '@/features/pwa/pwa'
import { isNetworkError } from '@/shared/lib/app-error'
import { resetPreferenceSync } from '@/shared/lib/preferences'
import { clearMediaCache } from '@/shared/lib/mediaCache'

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

export type RegisterInput = {
  email: string
  password: string
  display_name: string
  phone?: string
  as_master?: boolean
  as_supplier?: boolean
  as_supplier_rep?: boolean
  as_salon_admin?: boolean
  /** Master registration: chosen profession types (multi-select) and how the master works. */
  profession_type_ids?: string[]
  work_type?: string
  /** QR / link invitation into a salon. */
  invite_token?: string
}

type AuthState = {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  loading: boolean
  login: (email: string, password: string) => Promise<User>
  register: (input: RegisterInput) => Promise<User>
  logout: () => Promise<void>
  updateUser: (user: User) => void
}

const AuthContext = createContext<AuthState | null>(null)

function loadStored(): { accessToken: string; refreshToken: string; user: User } | null {
  const stored = readStoredSession()
  if (!stored) return null
  return { accessToken: stored.accessToken, refreshToken: stored.refreshToken, user: stored.user as User }
}

export function hasMasterAccess(user: User | null | undefined): boolean {
  if (!user) return false
  return user.roles.some((r) => r === 'master' || r === 'salon_owner' || r === 'system_admin')
}

export function hasSupplierAccess(user: User | null | undefined): boolean {
  if (!user) return false
  return user.roles.some((r) => r === 'supplier' || r === 'system_admin')
}

export function hasSupplierRepAccess(user: User | null | undefined): boolean {
  if (!user) return false
  return user.roles.some((r) => r === 'supplier_rep' || r === 'system_admin')
}

export function hasSalonAdmin(user: User | null | undefined): boolean {
  if (!user) return false
  return user.roles.some((r) => r === 'salon_admin' || r === 'salon_owner' || r === 'system_admin')
}

export function hasSystemAdmin(user: User | null | undefined): boolean {
  if (!user) return false
  return user.roles.includes('system_admin')
}

/** Default landing path after login/register by primary role. Master wins over supplier. */
export function homePathForUser(user: User | null | undefined): string {
  if (!user) return '/'
  if (hasSystemAdmin(user)) return '/admin'
  return '/'
}

type SessionRef = { accessToken: string | null; refreshToken: string | null; user: User | null }

export function AuthProvider({ children }: { children: ReactNode }) {
  const stored = loadStored()
  const [user, setUser] = useState<User | null>(stored?.user ?? null)
  const [accessToken, setAccessToken] = useState<string | null>(stored?.accessToken ?? null)
  const [refreshToken, setRefreshToken] = useState<string | null>(stored?.refreshToken ?? null)
  const [loading, setLoading] = useState(Boolean(stored?.accessToken))

  // The ref is the synchronous source of truth for the API client; React state is for rendering.
  const sessionRef = useRef<SessionRef>({
    accessToken: stored?.accessToken ?? null,
    refreshToken: stored?.refreshToken ?? null,
    user: stored?.user ?? null,
  })
  const loggingOutRef = useRef(false)
  const mountedRef = useRef(true)
  const hydratedRef = useRef(false)

  function commit(next: SessionRef, persist: boolean) {
    sessionRef.current = next
    setUser(next.user)
    setAccessToken(next.accessToken)
    setRefreshToken(next.refreshToken)
    if (persist && next.accessToken && next.refreshToken) {
      writeStoredSession({ accessToken: next.accessToken, refreshToken: next.refreshToken, user: next.user })
    }
  }

  /**
   * Single exit path for every way a session can end.
   * - `expired`: the server said the session is gone. Shows the soft notice on the login screen, but
   *   only if a session existed (late 401s after a normal logout must not look like an expiry).
   * - `logout` / `replaced`: deliberate; never shows a notice.
   */
  function endSession(reason: SessionEndReason) {
    const had = Boolean(sessionRef.current.accessToken || sessionRef.current.refreshToken)
    if (reason === 'expired' && (!had || loggingOutRef.current)) return
    if (reason === 'expired') markSessionEnded()
    else clearSessionEnded()
    sessionRef.current = { accessToken: null, refreshToken: null, user: null }
    setUser(null)
    setAccessToken(null)
    setRefreshToken(null)
    clearStoredSession()
    abortInFlightRequests()
    queryClient.clear()
    clearMediaCache()
    resetPreferenceSync()
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    bindAuthBridge({
      getSession: () => {
        const s = sessionRef.current
        if (!s.accessToken || !s.refreshToken) return null
        return { accessToken: s.accessToken, refreshToken: s.refreshToken }
      },
      setSession: (next, persist = true) => {
        const u = (next.user as User | undefined) ?? sessionRef.current.user
        commit({ accessToken: next.accessToken, refreshToken: next.refreshToken, user: u }, persist)
      },
      clearSession: (reason) => endSession(reason),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Startup: validate the stored session once. Guarded by a ref (not a per-effect "cancelled" flag)
  // so React StrictMode's simulated remount cannot start two refreshes or drop the result.
  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    async function hydrate() {
      const snap = readStoredSession()
      if (!snap) {
        if (mountedRef.current) setLoading(false)
        return
      }
      try {
        const token = await getFreshAccessToken()
        if (!token) {
          // Refresh returned a hard failure without clearing (e.g. 400). Treat as expiry.
          if (sessionRef.current.accessToken || sessionRef.current.refreshToken) endSession('expired')
          return
        }
        let me: User
        try {
          me = await apiRequest<User>('/v1/auth/me', { token, skipAuthRefresh: true })
        } catch (meErr) {
          if (!isUnauthorizedSessionError(meErr)) throw meErr
          // A fresh-looking token was rejected (revoked, secret rotated): renew once, then decide.
          const next = await refreshAccessToken(token)
          if (!next) return
          me = await apiRequest<User>('/v1/auth/me', { token: next, skipAuthRefresh: true })
        }
        const s = sessionRef.current
        if (mountedRef.current && s.accessToken && s.refreshToken) {
          commit({ ...s, user: me }, true)
        }
      } catch (err) {
        // Offline / server error: keep the stored session and user, the UI stays usable.
        if (!isNetworkError(err) && isUnauthorizedSessionError(err)) endSession('expired')
      } finally {
        if (mountedRef.current) setLoading(false)
      }
    }
    void hydrate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the access token fresh: refresh shortly before it expires and whenever the app becomes
  // visible/online again (phones suspend timers), so uploads and media never run on a dead token.
  useEffect(() => {
    if (!accessToken) return
    const exp = jwtExpiryMs(accessToken)
    if (!exp) return
    const timer = setTimeout(() => {
      void refreshAccessToken().catch(() => undefined)
    }, Math.max(5_000, exp - Date.now() - 60_000))
    return () => clearTimeout(timer)
  }, [accessToken])

  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === 'hidden' || !sessionRef.current.accessToken) return
      void getFreshAccessToken().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    window.addEventListener('focus', wake)
    return () => {
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
      window.removeEventListener('focus', wake)
    }
  }, [])

  // Multi-tab: a logout or a token rotation in another tab is reflected here.
  useEffect(() => {
    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== SESSION_STORAGE_KEY && ev.key !== null) return
      const next = readStoredSession()
      if (!next) {
        if (sessionRef.current.accessToken) endSession('logout')
        return
      }
      if (next.accessToken !== sessionRef.current.accessToken) {
        commit({ accessToken: next.accessToken, refreshToken: next.refreshToken, user: (next.user as User) ?? sessionRef.current.user }, false)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function applyAuth(res: AuthResponse) {
    loggingOutRef.current = false
    clearSessionEnded()
    queryClient.clear() // never show another user's cached data
    clearMediaCache()
    resetPreferenceSync()
    commit({ accessToken: res.access_token, refreshToken: res.refresh_token, user: res.user }, true)
  }

  const value = useMemo<AuthState>(
    () => ({
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
        // From here on, stray 401s from requests that were already in flight are not "expiry".
        loggingOutRef.current = true
        const rt = sessionRef.current.refreshToken
        if (rt) {
          try {
            await apiRequest('/v1/auth/logout', { body: { refresh_token: rt }, skipAuthRefresh: true })
          } catch {
            // the local session is cleared below regardless of the server answer
          }
        }
        endSession('logout')
        loggingOutRef.current = false
      },
      updateUser(next) {
        const s = sessionRef.current
        commit({ ...s, user: next }, true)
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, accessToken, refreshToken, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('AuthProvider missing')
  return ctx
}
