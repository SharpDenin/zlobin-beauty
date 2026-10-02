import type { Contact } from '@/features/contacts/types'

export function conversationStartBody(roles: string[] | null | undefined, userId: string): Record<string, unknown> | null {
  if (!userId) return null
  const set = new Set(roles ?? [])
  if (set.has('master') || set.has('salon_owner') || set.has('salon_admin')) {
    return { type: 'client_master', master_user_id: userId }
  }
  if (set.has('supplier') || set.has('supplier_rep')) {
    return { type: 'master_supplier', peer_user_id: userId }
  }
  if (set.has('client') || set.size === 0) {
    return { type: 'client_master', client_user_id: userId }
  }
  return { type: 'client_master', client_user_id: userId }
}

export function existingConversationId(contact: Pick<Contact, 'conversation_id'>): string | null {
  return contact.conversation_id || null
}
