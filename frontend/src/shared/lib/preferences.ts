import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { toast } from '@/shared/ui/Toast'

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

type PutVars<T> = { value: T; requestId: number }

/**
 * Server-persisted per-user preference with localStorage cache.
 * Optimistic UI rolls back to the last server-confirmed value on PUT failure.
 * Rapid toggles: only the latest in-flight requestId may commit or roll back.
 */
export function usePreference<T>(key: string, fallback: T): [T, (next: T | ((prev: T) => T)) => void] {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const [value, setLocal] = useState<T>(() => readCache(key, fallback))
  const valueRef = useRef(value)
  const confirmedRef = useRef<T>(readCache(key, fallback))
  const requestIdRef = useRef(0)
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
        const cached = readCache(key, fallback)
        setLocal(cached)
        confirmedRef.current = cached
      }
      return
    }
    hydrated.current = true
    const next = remote as T
    confirmedRef.current = next
    // Do not clobber a newer optimistic value while a put is in flight.
    if (requestIdRef.current !== 0) return
    if (!sameValue(valueRef.current, next)) {
      setLocal(next)
      writeCache(key, next)
    }
  }, [list.data, key, fallback])

  const put = useMutation({
    mutationFn: async ({ value: next, requestId }: PutVars<T>) => {
      await apiRequest(`/v1/me/preferences/${encodeURIComponent(key)}`, {
        method: 'PUT',
        token: accessToken,
        body: { value: next },
      })
      return { value: next, requestId }
    },
    onSuccess: (result) => {
      if (result.requestId !== requestIdRef.current) return
      confirmedRef.current = result.value
      writeCache(key, result.value)
      qc.setQueryData<PrefsPayload>(['me-preferences'], (old) => {
        const prefs = { ...(old?.preferences ?? {}), [key]: result.value }
        return { preferences: prefs }
      })
    },
    onError: (_err, vars) => {
      if (vars.requestId !== requestIdRef.current) return
      const rollback = confirmedRef.current
      valueRef.current = rollback
      writeCache(key, rollback)
      setLocal(rollback)
      toast.error('Не удалось сохранить настройку. Режим восстановлен.')
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
      if (accessToken) {
        const requestId = ++requestIdRef.current
        put.mutate({ value: resolved, requestId })
      } else {
        confirmedRef.current = resolved
      }
    },
    [accessToken, key, put],
  )

  return [value, setValue]
}
