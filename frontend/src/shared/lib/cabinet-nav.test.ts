import { describe, expect, it } from 'vitest'
import {
  canFeatureFromCaps,
  navForCabinet,
  resolveCabinetKind,
  resolveCapabilities,
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
    expect(withKindOnly.secondary.some((l) => l.to === '/staff')).toBe(true)
    const gated = navForCabinet(kind, (f) => canFeatureFromCaps(caps, f))
    expect(gated.secondary.some((l) => l.to === '/staff')).toBe(false)
    expect(gated.secondary.some((l) => l.to === '/salon/settings')).toBe(false)
    expect(gated.secondary.some((l) => l.to === '/reports')).toBe(false)
  })

  it('keeps owner action links when membership is active', () => {
    const orgs = [ownerOrg()]
    const caps = resolveCapabilities(baseUser(['salon_owner']), orgs, { id: 'm1', work_types: ['private_practice'] })
    const kind = resolveCabinetKind(baseUser(['salon_owner']), { orgs, master: { id: 'm1' } })
    const gated = navForCabinet(kind, (f) => canFeatureFromCaps(caps, f))
    expect(gated.secondary.some((l) => l.to === '/staff')).toBe(true)
    expect(gated.secondary.some((l) => l.to === '/salon/settings')).toBe(true)
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
    const all = [...nav.primary, ...nav.secondary, ...nav.side]
    expect(all.some((l) => l.to === '/rep/map')).toBe(false)
    expect(all.some((l) => l.label === 'Маршрут')).toBe(false)
  })

  it('exposes messenger and marketplaces without replacing notifications', () => {
    const client = navForCabinet('client')
    expect(client.primary.some((l) => l.to === '/more')).toBe(true)
    expect(client.secondary.some((l) => l.to === '/messages' && l.label === 'Сообщения')).toBe(true)
    expect(client.secondary.some((l) => l.to === '/settings' && l.label === 'Настройки')).toBe(true)
    expect(client.secondary.some((l) => l.to === '/profile')).toBe(true)
    expect(client.secondary.some((l) => l.to === '/models')).toBe(true)
    const master = navForCabinet('private_master')
    expect(master.secondary.some((l) => l.to === '/messages')).toBe(true)
    expect(master.secondary.some((l) => l.to === '/masterclasses')).toBe(true)
    expect(master.secondary.some((l) => l.to === '/models')).toBe(true)
    expect(master.secondary.some((l) => l.to === '/inventory' && l.label === 'Мой склад')).toBe(true)
    expect(master.secondary.some((l) => l.to === '/inventory/receipts' && l.label === 'На приёмке')).toBe(true)
    expect(master.secondary.some((l) => l.to === '/knowledge' && l.label === 'База знаний')).toBe(true)
    expect(master.secondary.some((l) => l.to === '/settings' && l.label === 'Настройки')).toBe(true)
    expect(master.secondary.filter((l) => l.label === 'Настройки')).toHaveLength(1)
  })

  it('keeps salon settings distinct from app settings for owners', () => {
    const owner = navForCabinet('salon_owner')
    expect(owner.secondary.some((l) => l.to === '/settings' && l.label === 'Настройки')).toBe(true)
    expect(owner.secondary.some((l) => l.to === '/salon/settings' && l.label === 'Настройки салона')).toBe(true)
    expect(owner.secondary.filter((l) => l.label === 'Настройки')).toHaveLength(1)
  })

  it('does not put personal warehouse on supplier nav', () => {
    const nav = navForCabinet('supplier')
    const all = [...nav.primary, ...nav.secondary, ...nav.side]
    expect(all.some((l) => l.to === '/inventory')).toBe(false)
  })

  it('exposes platform admin information architecture', () => {
    const nav = navForCabinet('platform_admin')
    const all = [...nav.primary, ...nav.secondary, ...nav.side]
    expect(nav.primary.some((l) => l.to === '/admin' && l.end)).toBe(true)
    expect(all.some((l) => l.to === '/admin/users')).toBe(true)
    expect(all.some((l) => l.to === '/admin/disputes')).toBe(true)
    expect(all.some((l) => l.to === '/admin/audit')).toBe(true)
    expect(all.some((l) => l.to === '/admin/catalogs')).toBe(true)
    expect(all.some((l) => l.to === '/calendar')).toBe(false)
    expect(resolveCabinetKind(baseUser(['system_admin', 'master']))).toBe('platform_admin')
  })
})
