import { useCallback, useEffect, useRef, useState } from 'react'
import type { FieldValues, UseFormReturn } from 'react-hook-form'
import { useAuth } from '@/features/auth/AuthProvider'

/**
 * Form draft persistence. Drafts live in sessionStorage (tab session only, never localStorage),
 * are scoped per signed-in user, expire after a few hours and never include sensitive-looking
 * fields (password, token, card, pin, ...). Call `clear()` after a successful submit.
 */

const PREFIX = 'zb.draft.'
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000
const SENSITIVE_TOKENS = new Set(['password', 'passwd', 'pwd', 'passcode', 'token', 'secret', 'card', 'cardnumber', 'cvv', 'cvc', 'pin', 'otp', 'code'])

type DraftEnvelope<T> = { t: number; v: T }

function draftKey(userId: string, key: string) {
  return `${PREFIX}${userId}.${key}`
}

function readDraft<T>(fullKey: string, ttlMs: number): T | null {
  try {
    const raw = sessionStorage.getItem(fullKey)
    if (!raw) return null
    const env = JSON.parse(raw) as DraftEnvelope<T>
    if (!env || typeof env.t !== 'number' || Date.now() - env.t > ttlMs) {
      sessionStorage.removeItem(fullKey)
      return null
    }
    return env.v
  } catch {
    return null
  }
}

function writeDraft<T>(fullKey: string, value: T) {
  try {
    sessionStorage.setItem(fullKey, JSON.stringify({ t: Date.now(), v: value } satisfies DraftEnvelope<T>))
  } catch {
    /* quota exceeded or storage disabled: losing a draft is acceptable */
  }
}

export function isSensitiveFieldName(name: string): boolean {
  const tokens = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  return tokens.some((t) => SENSITIVE_TOKENS.has(t) || t.startsWith('pass'))
}

export function sanitizeDraft<T extends Record<string, unknown>>(values: T, exclude: readonly string[] = []): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) {
    if (exclude.includes(k) || isSensitiveFieldName(k)) continue
    if (v instanceof File || v instanceof Blob) continue
    out[k] = v
  }
  return out as Partial<T>
}

type DraftOptions = {
  /** Extra field names that must never be stored (password-like names are always excluded). */
  exclude?: readonly (string | number | symbol)[]
  ttlMs?: number
  debounceMs?: number
}

/** react-hook-form: restore on mount, save on change. */
export function useFormDraft<T extends FieldValues>(
  form: UseFormReturn<T>,
  key: string,
  opts: DraftOptions = {},
): { clear: () => void; restored: boolean } {
  const { user } = useAuth()
  const fullKey = draftKey(user?.id ?? 'anon', key)
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS
  const debounce = opts.debounceMs ?? 300
  const exclude = (opts.exclude ?? []).map(String)
  const [restored, setRestored] = useState(false)
  const restoredOnce = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (restoredOnce.current) return
    restoredOnce.current = true
    const draft = readDraft<Partial<T>>(fullKey, ttl)
    if (draft && Object.keys(draft).length) {
      form.reset({ ...form.getValues(), ...draft } as T, { keepDefaultValues: true })
      setRestored(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey])

  useEffect(() => {
    const sub = form.watch((values) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        writeDraft(fullKey, sanitizeDraft(values as Record<string, unknown>, exclude))
      }, debounce)
    })
    return () => {
      sub.unsubscribe()
      if (timer.current) clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, fullKey, debounce])

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    try {
      sessionStorage.removeItem(fullKey)
    } catch {
      /* ignore */
    }
  }, [fullKey])

  return { clear, restored }
}

/** Plain `useState` forms: same storage rules. */
export function useDraftState<T extends Record<string, unknown>>(
  key: string,
  initial: T,
  opts: { exclude?: readonly string[]; ttlMs?: number } = {},
): [T, (next: T | ((prev: T) => T)) => void, () => void] {
  const { user } = useAuth()
  const fullKey = draftKey(user?.id ?? 'anon', key)
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS
  const exclude = opts.exclude ?? []
  const [state, setState] = useState<T>(() => ({ ...initial, ...(readDraft<Partial<T>>(fullKey, ttl) ?? {}) }))

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setState((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        writeDraft(fullKey, sanitizeDraft(resolved, exclude))
        return resolved
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fullKey],
  )

  const clear = useCallback(() => {
    try {
      sessionStorage.removeItem(fullKey)
    } catch {
      /* ignore */
    }
  }, [fullKey])

  return [state, update, clear]
}
