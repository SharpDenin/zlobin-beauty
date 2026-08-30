import { apiRequest } from '@/shared/api/client'
import type { Conversation, CreateConversationBody } from '@/features/messenger/types'

export async function openConversation(
  token: string | null,
  body: CreateConversationBody | Record<string, unknown>,
): Promise<Conversation> {
  return apiRequest<Conversation>('/v1/conversations', { method: 'POST', token, body })
}
