export const MAX_MESSAGE_CHARS = 4000
export const MESSAGE_PAGE_SIZE = 40

export type ConversationType = 'client_master' | 'master_supplier' | 'masterclass' | 'model_request' | string

export type ConversationParticipant = {
  user_id: string
  display_name: string
  role: string
  last_read_at?: string | null
}

export type ChatMessage = {
  id: string
  conversation_id?: string
  sender_user_id: string
  kind: 'text' | 'image' | 'video' | string
  body: string
  media_id?: string | null
  created_at: string
  status?: 'sending' | 'sent' | 'failed'
  client_id?: string
}

export type Conversation = {
  id: string
  type: ConversationType
  peer_name: string
  unread_count: number
  updated_at: string
  last_message?: ChatMessage | null
  participants: ConversationParticipant[]
  context_id?: string | null
}

export type MessageListResponse = {
  items: ChatMessage[]
  limit?: number
  has_more?: boolean
}

export type CreateConversationBody = {
  type: string
  master_user_id?: string
  client_user_id?: string
  supplier_organization_id?: string
  event_id?: string
  request_id?: string
  peer_user_id?: string
}
