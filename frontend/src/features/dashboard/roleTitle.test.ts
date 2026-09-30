import { describe, expect, it } from 'vitest'
import { roleTitle } from './roleTitle'

describe('roleTitle', () => {
  it('returns role subtitles without Кабинет', () => {
    const kinds = [
      'salon_owner',
      'private_master',
      'salon_employee',
      'chair_master',
      'mobile_master',
      'salon_admin',
      'chain_owner',
      'supplier',
      'supplier_rep',
    ] as const
    for (const kind of kinds) {
      const title = roleTitle(kind)
      expect(title).not.toMatch(/Кабинет/i)
      expect(title.length).toBeGreaterThan(0)
    }
  })

  it('maps expected Russian titles', () => {
    expect(roleTitle('salon_owner')).toBe('Владелец салона')
    expect(roleTitle('private_master')).toBe('Частный мастер')
    expect(roleTitle('supplier')).toBe('Поставщик')
    expect(roleTitle('supplier_rep')).toBe('Представитель поставщика')
  })
})
