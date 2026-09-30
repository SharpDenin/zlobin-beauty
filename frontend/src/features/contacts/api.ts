import { apiRequest } from '@/shared/api/client'
import type { AddContactBody, Contact, ContactListResponse, ContactSearchResponse } from '@/features/contacts/types'

export function listContacts(
  token: string | null,
  params: { q?: string; role?: string; limit?: number; offset?: number } = {},
) {
  const qs = new URLSearchParams()
  if (params.q) qs.set('q', params.q)
  if (params.role) qs.set('role', params.role)
  if (params.limit != null) qs.set('limit', String(params.limit))
  if (params.offset != null) qs.set('offset', String(params.offset))
  const q = qs.toString()
  return apiRequest<ContactListResponse>(`/v1/contacts${q ? `?${q}` : ''}`, { token })
}

export function searchPeople(token: string | null, q: string) {
  return apiRequest<ContactSearchResponse>(`/v1/contacts/search?q=${encodeURIComponent(q)}`, { token })
}

export function addContact(token: string | null, body: AddContactBody) {
  return apiRequest<Contact>('/v1/contacts', { method: 'POST', token, body })
}

export function updateContactNote(token: string | null, id: string, note: string) {
  return apiRequest<Contact>(`/v1/contacts/${id}`, { method: 'PATCH', token, body: { note } })
}

export function deleteContact(token: string | null, id: string) {
  return apiRequest<void>(`/v1/contacts/${id}`, { method: 'DELETE', token })
}
