import { newIdempotencyKey } from '@/shared/lib/commerce'

const STORAGE_PREFIX = 'zb.dye-stock-idem.v1'
const TTL_MS = 7 * 24 * 60 * 60 * 1000

export type DyeStockIdemLine = {
  key: string
  fingerprint: string
  qty: number
}

export type DyeStockIdemSession = {
  mode: 'master' | 'warehouse'
  organizationId: string
  locationId: string
  brand: string
  reason: string
  /** productId → stable key for current fingerprint */
  lines: Record<string, DyeStockIdemLine>
  updatedAt: number
}

export function dyeStockIdemStorageKey(mode: string, organizationId: string, locationId: string) {
  return `${STORAGE_PREFIX}:${mode}:${organizationId}:${locationId || 'master'}`
}

export function lineFingerprint(qty: number, reason: string) {
  return `${qty}|${reason.trim()}`
}

function readStorage(key: string): DyeStockIdemSession | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DyeStockIdemSession
    if (!parsed || typeof parsed !== 'object') return null
    if (Date.now() - (parsed.updatedAt || 0) > TTL_MS) {
      sessionStorage.removeItem(key)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeStorage(key: string, session: DyeStockIdemSession) {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(key, JSON.stringify({ ...session, updatedAt: Date.now() }))
  } catch {
    /* quota / private mode — in-memory keys still work for the session */
  }
}

export function clearDyeStockIdemSession(mode: string, organizationId: string, locationId: string) {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(dyeStockIdemStorageKey(mode, organizationId, locationId))
  } catch {
    /* ignore */
  }
}

export function loadDyeStockIdemSession(
  mode: 'master' | 'warehouse',
  organizationId: string,
  locationId: string,
): DyeStockIdemSession | null {
  const stored = readStorage(dyeStockIdemStorageKey(mode, organizationId, locationId))
  if (!stored) return null
  if (stored.mode !== mode || stored.organizationId !== organizationId) return null
  if ((stored.locationId || '') !== (locationId || '')) return null
  return stored
}

/** Ensure each line has a stable key for its fingerprint; rotate when qty/reason change. */
export function ensureDyeLineIdemKeys(
  session: DyeStockIdemSession | null,
  args: {
    mode: 'master' | 'warehouse'
    organizationId: string
    locationId: string
    brand: string
    reason: string
    lines: Array<{ productId: string; qty: number }>
  },
): { session: DyeStockIdemSession; keysByProduct: Record<string, string> } {
  const next: DyeStockIdemSession = {
    mode: args.mode,
    organizationId: args.organizationId,
    locationId: args.locationId || '',
    brand: args.brand,
    reason: args.reason,
    lines: { ...(session?.lines ?? {}) },
    updatedAt: Date.now(),
  }
  const keysByProduct: Record<string, string> = {}
  const keep = new Set(args.lines.map((l) => l.productId))
  for (const id of Object.keys(next.lines)) {
    if (!keep.has(id)) delete next.lines[id]
  }
  for (const line of args.lines) {
    const fp = lineFingerprint(line.qty, args.reason)
    const prev = next.lines[line.productId]
    if (prev && prev.fingerprint === fp && prev.key) {
      keysByProduct[line.productId] = prev.key
      continue
    }
    const key = newIdempotencyKey()
    next.lines[line.productId] = { key, fingerprint: fp, qty: line.qty }
    keysByProduct[line.productId] = key
  }
  writeStorage(dyeStockIdemStorageKey(args.mode, args.organizationId, args.locationId || ''), next)
  return { session: next, keysByProduct }
}

export function dropAppliedDyeIdemLines(
  session: DyeStockIdemSession | null,
  appliedProductIds: string[],
): DyeStockIdemSession | null {
  if (!session) return null
  const next: DyeStockIdemSession = {
    ...session,
    lines: { ...session.lines },
    updatedAt: Date.now(),
  }
  for (const id of appliedProductIds) delete next.lines[id]
  writeStorage(dyeStockIdemStorageKey(session.mode, session.organizationId, session.locationId || ''), next)
  return next
}
