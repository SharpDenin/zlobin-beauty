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
      timezone: '',
    })).toEqual({
      name: 'Аура',
      city: 'Красноярск',
      address_line: '',
      type: 'salon',
      timezone: 'Asia/Krasnoyarsk',
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
      timezone: '',
    })).toEqual({
      name: 'Аура',
      city: 'Красноярск',
      address_line: 'Ленина 1',
      type: 'salon',
      timezone: 'Asia/Krasnoyarsk',
      branch_name: 'Центр',
      branch_city: 'Красноярск',
      branch_address_line: 'Ленина 1',
      phone: '+79001112233',
    })
  })

  it('maps Moscow city to Europe/Moscow', () => {
    expect(buildCreateSalonBody({
      name: 'Салон',
      city: 'Москва',
      address_line: '',
      with_branch: false,
      branch_name: '',
      branch_address_line: '',
      phone: '',
      timezone: '',
    }).timezone).toBe('Europe/Moscow')
  })

  it('does not silently assign Europe/Moscow for unknown cities', () => {
    const body = buildCreateSalonBody({
      name: 'Салон',
      city: 'Владивосток',
      address_line: 'Ленина 1',
      with_branch: true,
      branch_name: 'Центр',
      branch_address_line: 'Ленина 1',
      phone: '',
      timezone: '',
    })
    expect(body.timezone).toBeUndefined()
  })

  it('keeps explicit IANA for unknown cities', () => {
    expect(buildCreateSalonBody({
      name: 'Салон',
      city: 'Владивосток',
      address_line: '',
      with_branch: true,
      branch_name: 'Центр',
      branch_address_line: 'Ленина 1',
      phone: '',
      timezone: 'Asia/Vladivostok',
    }).timezone).toBe('Asia/Vladivostok')
  })
})
