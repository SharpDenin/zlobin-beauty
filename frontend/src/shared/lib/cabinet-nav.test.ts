import { describe, expect, it } from 'vitest'
import {
  canFeatureFromCaps,
  navForCabinet,
  navHasPath,
  resolveCabinetKind,
  resolveCapabilities,
  topLevelNavCount,
} from './cabinet'
import type { User } from '@/features/auth/AuthProvider'
import type { OrgItem } from '@/shared/lib/commerce'

const baseUser = (roles: string[]): User => ({
  id: '1',
  email: 'a@x',
  phone: null,
  display_name: 'A',
  city: '',
  roles,
  status: 'active',
})

const ownerOrg = (id = 'o1', name = 'S'): OrgItem => ({
  organization: { id, name, type: 'salon' },
  branches: [{ id: `b-${id}`, name: 'Main', city: 'X', address_line: '1', phone: '' }],
  roles: ['owner'],
})

describe('resolveCapabilities / legacy owner shell', () => {
  it('does not grant owner actions from work_type alone (no membership)', () => {
    const caps = resolveCapabilities(
      baseUser(['master']),
      [],
      { id: 'm1', work_type: 'salon_owner', work_types: ['salon_owner'] },
    )
    expect(caps.isSalonOwner).toBe(false)
    expect(caps.legacyOwnerShell).toBe('salon_owner')
    expect(canFeatureFromCaps(caps, 'staff')).toBe(false)
    expect(canFeatureFromCaps(caps, 'reports')).toBe(false)
    expect(canFeatureFromCaps(caps, 'salon_settings')).toBe(false)
    expect(resolveCabinetKind(baseUser(['master']), {
      orgs: [],
      master: { id: 'm1', work_type: 'salon_owner' },
    })).toBe('salon_owner')
  })

  it('does not grant owner actions from identity salon_owner alone', () => {
    const caps = resolveCapabilities(baseUser(['salon_owner', 'master']), [], {
      id: 'm1',
      work_type: 'private_practice',
      work_types: ['private_practice'],
    })
    expect(caps.isSalonOwner).toBe(false)
    expect(caps.identityOwnerClaim).toBe(true)
    expect(canFeatureFromCaps(caps, 'staff')).toBe(false)
    expect(resolveCabinetKind(baseUser(['salon_owner', 'master']), {
      orgs: [],
      master: { id: 'm1', work_types: ['private_practice'] },
    })).toBe('salon_owner')
  })

  it('grants owner actions with active owner membership', () => {
    const orgs = [ownerOrg()]
    const caps = resolveCapabilities(baseUser(['salon_owner', 'master']), orgs, {
      id: 'm1',
      work_types: ['private_practice'],
    })
    expect(caps.isSalonOwner).toBe(true)
    expect(caps.identityOwnerClaim).toBe(false)
    expect(canFeatureFromCaps(caps, 'staff')).toBe(true)
    expect(canFeatureFromCaps(caps, 'salon_settings')).toBe(true)
  })

  it('REG-03: owner membership alone does not grant master capabilities', () => {
    const orgs = [ownerOrg()]
    const caps = resolveCapabilities(baseUser(['client']), orgs, null)
    expect(caps.isSalonOwner).toBe(true)
    expect(caps.isMaster).toBe(false)
    expect(canFeatureFromCaps(caps, 'staff')).toBe(true)
    expect(resolveCabinetKind(baseUser(['client']), { orgs, master: null })).toBe('salon_owner')
  })

  it('REG-03: owner + master keeps both capability sets', () => {
    const orgs = [ownerOrg()]
    const master = { id: 'm1', work_types: ['private_practice'] }
    const caps = resolveCapabilities(baseUser(['master']), orgs, master)
    expect(caps.isSalonOwner).toBe(true)
    expect(caps.isMaster).toBe(true)
  })

  it('treats inactive membership as absent (not in mine list)', () => {
    // /organizations/mine only returns status=active — empty orgs simulates removed/inactive.
    const caps = resolveCapabilities(baseUser(['salon_owner']), [], {
      id: 'm1',
      work_type: 'salon_owner',
    })
    expect(caps.isSalonOwner).toBe(false)
    expect(canFeatureFromCaps(caps, 'reports')).toBe(false)
  })

  it('hides owner action links in nav when shell is legacy-only', () => {
    const caps = resolveCapabilities(baseUser(['master']), [], {
      id: 'm1',
      work_type: 'salon_owner',
    })
    const kind = resolveCabinetKind(baseUser(['master']), {
      orgs: [],
      master: { id: 'm1', work_type: 'salon_owner' },
    })
    expect(kind).toBe('salon_owner')
    const withKindOnly = navForCabinet(kind)
    expect(navHasPath(withKindOnly.side, '/staff')).toBe(true)
    const gated = navForCabinet(kind, (f) => canFeatureFromCaps(caps, f))
    expect(navHasPath(gated.side, '/staff')).toBe(false)
    expect(navHasPath(gated.side, '/salon/settings')).toBe(false)
    expect(navHasPath(gated.side, '/reports')).toBe(false)
  })

  it('keeps owner action links when membership is active', () => {
    const orgs = [ownerOrg()]
    const caps = resolveCapabilities(baseUser(['salon_owner']), orgs, { id: 'm1', work_types: ['private_practice'] })
    const kind = resolveCabinetKind(baseUser(['salon_owner']), { orgs, master: { id: 'm1' } })
    const gated = navForCabinet(kind, (f) => canFeatureFromCaps(caps, f))
    expect(navHasPath(gated.side, '/staff')).toBe(true)
    expect(navHasPath(gated.side, '/salon/settings')).toBe(true)
  })

  it('does not treat work_type ownership as the sole owner signal when membership exists', () => {
    const kind = resolveCabinetKind(baseUser(['master']), {
      orgs: [ownerOrg()],
      master: { id: 'm1', work_type: 'private_practice', work_types: ['private_practice'] },
    })
    expect(kind).toBe('salon_owner')
  })

  it('ignores work_type employee for cabinet kind when membership is master', () => {
    const kind = resolveCabinetKind(baseUser(['master']), {
      orgs: [{ organization: { id: 'o1', name: 'S', type: 'salon' }, branches: [], roles: ['master'] }],
      master: { id: 'm1', work_type: 'employee', work_types: ['employee'] },
    })
    expect(kind).toBe('salon_employee')
  })

  it('switches to client UI mode without dropping membership ownership capabilities', () => {
    const orgs = [ownerOrg()]
    const master = { id: 'm1', work_type: 'private_practice', work_types: ['private_practice', 'chair_rental'] }
    const caps = resolveCapabilities(baseUser(['salon_owner', 'master']), orgs, master)
    expect(caps.isSalonOwner).toBe(true)
    expect(caps.isMaster).toBe(true)
    expect(caps.workFormats).toEqual(['private_practice', 'chair_rental'])
    expect(resolveCabinetKind(baseUser(['salon_owner', 'master']), { orgs, master, interactionMode: 'client' })).toBe('client')
    expect(resolveCabinetKind(baseUser(['salon_owner', 'master']), { orgs, master, interactionMode: 'master' })).toBe('salon_owner')
  })

  it('REG-03: owner-only stays in owner shell without master mode signals', () => {
    const orgs = [ownerOrg()]
    const caps = resolveCapabilities(baseUser(['client']), orgs, {})
    expect(caps.isMaster).toBe(false)
    expect(caps.isSalonOwner).toBe(true)
    expect(resolveCabinetKind(baseUser(['client']), { orgs, master: {}, interactionMode: 'master' })).toBe('salon_owner')
  })

  it('marks chain ops when owning multiple salons via membership only', () => {
    const kind = resolveCabinetKind(baseUser(['salon_owner']), {
      orgs: [ownerOrg('o1', 'A'), ownerOrg('o2', 'B')],
      master: { id: 'm1', work_types: ['private_practice'] },
    })
    expect(kind).toBe('chain_owner')
    const legacyOnly = resolveCapabilities(baseUser(['master']), [], { work_type: 'chain_owner' })
    expect(legacyOnly.isChainOps).toBe(false)
    expect(legacyOnly.legacyOwnerShell).toBe('chain_owner')
  })
})

describe('navForCabinet', () => {
  it('does not expose /rep/map to sales reps', () => {
    const nav = navForCabinet('supplier_rep')
    expect(navHasPath(nav.side, '/rep/map')).toBe(false)
  })

  it('exposes messenger and marketplaces without replacing notifications', () => {
    const client = navForCabinet('client')
    expect(client.primary.some((l) => l.to === '/search' && l.label === 'Поиск мастера')).toBe(true)
    expect(client.primary.some((l) => l.to === '/more')).toBe(true)
    expect(navHasPath(client.side, '/messages')).toBe(true)
    expect(navHasPath(client.side, '/models')).toBe(true)
    expect(navHasPath(client.side, '/consultations')).toBe(true)
    expect(navHasPath(client.side, '/settings')).toBe(false)
    expect(topLevelNavCount(client.side)).toBeLessThanOrEqual(10)
    const master = navForCabinet('private_master')
    expect(navHasPath(master.side, '/messages')).toBe(true)
    expect(navHasPath(master.side, '/masterclasses')).toBe(true)
    expect(navHasPath(master.side, '/models')).toBe(true)
    expect(navHasPath(master.side, '/consultations')).toBe(true)
    expect(navHasPath(master.side, '/inventory')).toBe(true)
    expect(navHasPath(master.side, '/inventory/receipts')).toBe(true)
    expect(navHasPath(master.side, '/knowledge')).toBe(true)
    expect(navHasPath(master.side, '/settings')).toBe(false)
    expect(topLevelNavCount(master.side)).toBeLessThanOrEqual(10)
  })

  it('keeps salon settings under Салон group for owners', () => {
    const owner = navForCabinet('salon_owner')
    expect(navHasPath(owner.side, '/salon/settings')).toBe(true)
    expect(navHasPath(owner.side, '/settings')).toBe(false)
    expect(topLevelNavCount(owner.side)).toBeLessThanOrEqual(10)
  })

  it('does not put personal warehouse on supplier nav', () => {
    const nav = navForCabinet('supplier')
    expect(navHasPath(nav.side, '/inventory')).toBe(false)
    expect(topLevelNavCount(nav.side)).toBeLessThanOrEqual(10)
  })

  it('exposes platform admin information architecture', () => {
    const nav = navForCabinet('platform_admin')
    expect(nav.primary.some((l) => l.to === '/admin' && l.end)).toBe(true)
    expect(navHasPath(nav.side, '/admin/users')).toBe(true)
    expect(navHasPath(nav.side, '/admin/disputes')).toBe(true)
    expect(navHasPath(nav.side, '/admin/audit')).toBe(true)
    expect(navHasPath(nav.side, '/admin/catalogs')).toBe(true)
    expect(navHasPath(nav.side, '/calendar')).toBe(false)
    expect(topLevelNavCount(nav.side)).toBeLessThanOrEqual(10)
    expect(resolveCabinetKind(baseUser(['system_admin', 'master']))).toBe('platform_admin')
  })

  it('keeps master-owner combo within 10 top-level items', () => {
    const orgs = [ownerOrg()]
    const caps = resolveCapabilities(baseUser(['master']), orgs, { id: 'm1', work_types: ['private_practice'] })
    const kind = resolveCabinetKind(baseUser(['master']), { orgs, master: { id: 'm1' } })
    const gated = navForCabinet(kind, (f) => canFeatureFromCaps(caps, f))
    expect(topLevelNavCount(gated.side)).toBeLessThanOrEqual(10)
    expect(navHasPath(gated.side, '/clients/invite')).toBe(true)
    expect(navHasPath(gated.side, '/staff/invite')).toBe(true)
  })

  it('Stage 5 closing: exact top-level counts for five capability combos', () => {
    const client = navForCabinet('client')
    expect(topLevelNavCount(client.side)).toBe(7)

    const masterCaps = resolveCapabilities(baseUser(['master']), [], {
      id: 'm1',
      work_types: ['private_practice'],
    })
    const masterKind = resolveCabinetKind(baseUser(['master']), {
      orgs: [],
      master: { id: 'm1', work_types: ['private_practice'] },
    })
    const masterNav = navForCabinet(masterKind, (f) => canFeatureFromCaps(masterCaps, f))
    expect(topLevelNavCount(masterNav.side)).toBe(9)

    const orgs = [ownerOrg()]
    const ownerOnlyCaps = resolveCapabilities(baseUser(['client']), orgs, null)
    const ownerOnlyKind = resolveCabinetKind(baseUser(['client']), { orgs, master: null })
    const ownerOnlyNav = navForCabinet(ownerOnlyKind, (f) => canFeatureFromCaps(ownerOnlyCaps, f))
    // Owner-only: no knowledge/cosmetics (masterLike false); still has pickup Склад + reports.
    expect(topLevelNavCount(ownerOnlyNav.side)).toBe(9)

    const bothCaps = resolveCapabilities(baseUser(['master']), orgs, {
      id: 'm1',
      work_types: ['private_practice'],
    })
    const bothKind = resolveCabinetKind(baseUser(['master']), {
      orgs,
      master: { id: 'm1', work_types: ['private_practice'] },
    })
    const bothNav = navForCabinet(bothKind, (f) => canFeatureFromCaps(bothCaps, f))
    expect(topLevelNavCount(bothNav.side)).toBe(10)

    const dualClientKind = resolveCabinetKind(baseUser(['master', 'client']), {
      orgs,
      master: { id: 'm1', work_types: ['private_practice'] },
      interactionMode: 'client',
    })
    const dualClientNav = navForCabinet(dualClientKind, (f) => canFeatureFromCaps(bothCaps, f))
    expect(dualClientKind).toBe('client')
    expect(topLevelNavCount(dualClientNav.side)).toBe(7)
  })
})
