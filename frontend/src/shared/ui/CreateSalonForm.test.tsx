import { describe, expect, it } from 'vitest'
import { buildCreateSalonBody } from '@/shared/ui/CreateSalonForm'

describe('CreateSalonForm payload', () => {
  it('builds org-only body without branch fields', () => {
    expect(buildCreateSalonBody({
      name: 'Аура',
      city: 'Красноярск',
      address_line: '',
      with_branch: false,
      branch_name: '',
      branch_address_line: '',
      phone: '',
    })).toEqual({
      name: 'Аура',
      city: 'Красноярск',
      address_line: '',
      type: 'salon',
    })
  })

  it('includes branch fields when enabled (legacy-compatible)', () => {
    expect(buildCreateSalonBody({
      name: 'Аура',
      city: 'Красноярск',
      address_line: 'Ленина 1',
      with_branch: true,
      branch_name: 'Центр',
      branch_address_line: '',
      phone: '+79001112233',
    })).toEqual({
      name: 'Аура',
      city: 'Красноярск',
      address_line: 'Ленина 1',
      type: 'salon',
      branch_name: 'Центр',
      branch_city: 'Красноярск',
      branch_address_line: 'Ленина 1',
      phone: '+79001112233',
    })
  })
})
