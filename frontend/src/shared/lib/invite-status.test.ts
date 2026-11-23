import { describe, expect, it } from 'vitest'
import { inviteRoleLabel, inviteStatusLabel } from './invite-status'

describe('invite-status', () => {
  it('labels statuses in Russian', () => {
    expect(inviteStatusLabel('active')).toBe('Активно')
    expect(inviteStatusLabel('accepted')).toBe('Принято')
    expect(inviteStatusLabel('revoked')).toBe('Отозвано')
    expect(inviteStatusLabel('expired')).toBe('Истекло')
    expect(inviteStatusLabel('exhausted')).toBe('Использовано')
  })

  it('labels roles', () => {
    expect(inviteRoleLabel('master')).toBe('Мастер')
    expect(inviteRoleLabel('client')).toBe('Клиент')
    expect(inviteRoleLabel('admin')).toBe('Администратор')
  })
})
