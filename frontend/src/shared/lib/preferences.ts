import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'

const CACHE_PREFIX = 'sx.pref.'

function readCache<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key)
    if (raw == null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeCache<T>(key: string, value: T) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value))
  } catch {
    /* ignore quota */
  }
}

/** Clear cached preference values on logout / session end. */
export function resetPreferenceSync() {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(CACHE_PREFIX)) keys.push(k)
    }
    for (const k of keys) localStorage.removeItem(k)
  } catch {
    /* ignore */
  }
}

function sameValue<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

type PrefsPayload = { preferences: Record<string, unknown> }

/**
 * Server-persisted per-user preference with localStorage cache.
 * Signature used across the app; identity API: GET/PUT /v1/me/preferences.
 */
export function usePreference<T>(key: string, fallback: T): [T, (next: T | ((prev: T) => T)) => void] {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const [value, setLocal] = useState<T>(() => readCache(key, fallback))
  const valueRef = useRef(value)
  const hydrated = useRef(false)
  valueRef.current = value

  const list = useQuery({
    queryKey: ['me-preferences'],
    queryFn: () => apiRequest<PrefsPayload>('/v1/me/preferences', { token: accessToken }),
    enabled: Boolean(accessToken),
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!list.data?.preferences) return
    const remote = list.data.preferences[key]
    if (remote === undefined) {
      if (!hydrated.current) {
        hydrated.current = true
        setLocal(readCache(key, fallback))
      }
      return
    }
    hydrated.current = true
    const next = remote as T
    if (!sameValue(valueRef.current, next)) {
      setLocal(next)
      writeCache(key, next)
    }
  }, [list.data, key, fallback])

  const put = useMutation({
    mutationFn: (next: T) =>
      apiRequest(`/v1/me/preferences/${encodeURIComponent(key)}`, {
        method: 'PUT',
        token: accessToken,
        body: { value: next },
      }),
    onSuccess: (_data, next) => {
      qc.setQueryData<PrefsPayload>(['me-preferences'], (old) => {
        const prefs = { ...(old?.preferences ?? {}), [key]: next }
        return { preferences: prefs }
      })
    },
  })

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = valueRef.current
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
      if (sameValue(resolved, prev)) return
      valueRef.current = resolved
      writeCache(key, resolved)
      setLocal(resolved)
      if (accessToken) put.mutate(resolved)
    },
    [accessToken, key, put],
  )

  return [value, setValue]
}
