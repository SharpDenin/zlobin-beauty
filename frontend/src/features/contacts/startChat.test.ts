import { describe, expect, it } from 'vitest'
import { conversationStartBody } from '@/features/contacts/startChat'

describe('conversationStartBody', () => {
  it('opens a master chat for professional roles', () => {
    expect(conversationStartBody(['master'], 'u1')).toEqual({ type: 'client_master', master_user_id: 'u1' })
    expect(conversationStartBody(['salon_owner'], 'u2')).toEqual({ type: 'client_master', master_user_id: 'u2' })
  })

  it('opens a client chat for clients', () => {
    expect(conversationStartBody(['client'], 'c1')).toEqual({ type: 'client_master', client_user_id: 'c1' })
  })

  it('does not invent a second role system for suppliers', () => {
    expect(conversationStartBody(['supplier'], 's1')).toEqual({ type: 'master_supplier', peer_user_id: 's1' })
  })
})
