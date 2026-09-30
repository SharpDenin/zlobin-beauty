export type Contact = {
  id: string
  user_id: string
  display_name: string
  roles: string[]
  city: string
  avatar_media_id: string | null
  note: string
  conversation_id: string | null
  created_at: string
}

export type ContactListResponse = {
  items: Contact[]
  total: number
  limit: number
  offset: number
}

export type ContactSearchHit = {
  id: string
  display_name: string
  roles: string[]
  city: string
  avatar_media_id: string | null
  already_added: boolean
}

export type ContactSearchResponse = {
  items: ContactSearchHit[]
}

export type AddContactBody = {
  user_id?: string
  email?: string
  phone?: string
  note?: string
}
