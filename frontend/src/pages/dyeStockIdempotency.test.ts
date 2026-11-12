import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearDyeStockIdemSession,
  dropAppliedDyeIdemLines,
  ensureDyeLineIdemKeys,
  lineFingerprint,
  loadDyeStockIdemSession,
} from '@/pages/dyeStockIdempotency'

afterEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('dyeStockIdempotency', () => {
  it('keeps the same key for identical fingerprint and rotates on qty change', () => {
    const first = ensureDyeLineIdemKeys(null, {
      mode: 'master',
      organizationId: 'org-1',
      locationId: '',
      brand: 'Wella',
      reason: 'приход',
      lines: [{ productId: 'p1', qty: 2 }],
    })
    const retry = ensureDyeLineIdemKeys(first.session, {
      mode: 'master',
      organizationId: 'org-1',
      locationId: '',
      brand: 'Wella',
      reason: 'приход',
      lines: [{ productId: 'p1', qty: 2 }],
    })
    expect(retry.keysByProduct.p1).toBe(first.keysByProduct.p1)

    const changed = ensureDyeLineIdemKeys(retry.session, {
      mode: 'master',
      organizationId: 'org-1',
      locationId: '',
      brand: 'Wella',
      reason: 'приход',
      lines: [{ productId: 'p1', qty: 5 }],
    })
    expect(changed.keysByProduct.p1).not.toBe(first.keysByProduct.p1)
    expect(lineFingerprint(5, 'приход')).toBe('5|приход')
  })

  it('persists unfinished lines in sessionStorage across load', () => {
    const created = ensureDyeLineIdemKeys(null, {
      mode: 'warehouse',
      organizationId: 'org-1',
      locationId: 'loc-1',
      brand: 'Loreal',
      reason: 'ручной',
      lines: [
        { productId: 'p1', qty: 1 },
        { productId: 'p2', qty: 3 },
      ],
    })
    const partial = dropAppliedDyeIdemLines(created.session, ['p1'])
    expect(partial?.lines.p1).toBeUndefined()
    expect(partial?.lines.p2?.key).toBe(created.keysByProduct.p2)

    const loaded = loadDyeStockIdemSession('warehouse', 'org-1', 'loc-1')
    expect(loaded?.lines.p2?.key).toBe(created.keysByProduct.p2)
    expect(loaded?.lines.p1).toBeUndefined()

    clearDyeStockIdemSession('warehouse', 'org-1', 'loc-1')
    expect(loadDyeStockIdemSession('warehouse', 'org-1', 'loc-1')).toBeNull()
  })
})
