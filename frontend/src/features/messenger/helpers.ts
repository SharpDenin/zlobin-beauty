import { MAX_MESSAGE_CHARS } from '@/features/messenger/types'
import type { ChatMessage } from '@/features/messenger/types'

export { MAX_MESSAGE_CHARS }

export function conversationTypeLabel(type: string) {
  switch (type) {
    case 'client_master':
      return 'Клиент и мастер'
    case 'master_supplier':
      return 'Мастер и поставщик'
    case 'masterclass':
      return 'Обучение'
    case 'model_request':
      return 'Модели'
    default:
      return 'Диалог'
  }
}

export function lastMessagePreview(msg?: Pick<ChatMessage, 'body' | 'kind' | 'deleted_at' | 'forwarded_from_message_id'> | null) {
  if (msg?.deleted_at) return 'Сообщение удалено'
  const body = msg?.body?.trim() ?? ''
  const fwd = msg?.forwarded_from_message_id ? 'Переслано · ' : ''
  if (body) return `${fwd}${body}`
  if (msg?.kind === 'video') return `${fwd}Видео`
  if (msg?.kind === 'image') return `${fwd}Фото`
  return 'Нет сообщений'
}

export function peerInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '')
  return letters.join('') || '?'
}

export function canSendMessage(text: string, file: File | null) {
  const body = text.trim()
  if (body.length > MAX_MESSAGE_CHARS) return false
  return Boolean(body) || Boolean(file)
}

export function emptyMessengerAction(kind: string): { label: string; to: string } | null {
  if (kind === 'client') return { label: 'Напишите мастеру', to: '/search' }
  if (kind === 'supplier' || kind === 'supplier_rep') return null
  return { label: 'Связаться с поставщиком', to: '/cosmetics' }
}

export function isNearBottom(el: HTMLElement, threshold = 80) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold
}

export function formatMessageTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Deterministic order: created_at ASC, then id ASC (UUID string tie-break). */
export function compareMessages(
  a: Pick<ChatMessage, 'id' | 'created_at'>,
  b: Pick<ChatMessage, 'id' | 'created_at'>,
): number {
  const ta = Date.parse(a.created_at)
  const tb = Date.parse(b.created_at)
  const aOk = Number.isFinite(ta)
  const bOk = Number.isFinite(tb)
  if (aOk && bOk && ta !== tb) return ta - tb
  if (aOk && !bOk) return -1
  if (!aOk && bOk) return 1
  return String(a.id).localeCompare(String(b.id))
}

export function messageDedupeKey(m: Pick<ChatMessage, 'id' | 'client_id'>): string {
  if (m.client_id) return `c:${m.client_id}`
  return `i:${m.id}`
}

/**
 * Merge older pages + live server page + optimistic locals without duplicates.
 * Prefer server rows over optimistic when client_id/id collide; keep failed locals.
 */
export function mergeConversationMessages<T extends ChatMessage>(
  older: T[],
  serverItems: T[],
  local: T[],
): T[] {
  const byId = new Map<string, T>()
  const clientToId = new Map<string, string>()

  const upsert = (m: T) => {
    byId.set(m.id, m)
    if (m.client_id) clientToId.set(m.client_id, m.id)
  }

  for (const m of older) upsert({ ...m, status: m.status ?? 'sent' })
  for (const m of serverItems) upsert({ ...m, status: 'sent' })

  for (const m of local) {
    if (m.client_id && clientToId.has(m.client_id)) continue
    if (byId.has(m.id)) continue
    upsert(m)
  }

  return [...byId.values()].sort(compareMessages)
}

export const MESSAGE_POLL_VISIBLE_MS = 1500
export const MESSAGE_POLL_HIDDEN_MS = 8000
export const CONVERSATION_LIST_POLL_VISIBLE_MS = 4000
export const CONVERSATION_LIST_POLL_HIDDEN_MS = 12000

export function messengerPollInterval(visibleMs: number, hiddenMs: number): number | false {
  if (typeof document === 'undefined') return visibleMs
  return document.visibilityState === 'visible' ? visibleMs : hiddenMs
}

export const DESKTOP_MESSENGER_MQ = '(min-width: 768px)'

export function isDesktopMessenger() {
  return typeof window !== 'undefined' && window.matchMedia(DESKTOP_MESSENGER_MQ).matches
}

/**
 * Master user id to open the existing booking flow (`/masters/:id`) from a chat.
 * Shown when the peer participates as master and the current user is not that master.
 * Skips supplier threads (not a client booking context).
 */
export function bookingMasterUserId(
  conversation: { type?: string; participants?: Array<{ user_id: string; role: string }> } | null | undefined,
  currentUserId: string | null | undefined,
): string | null {
  if (!conversation || !currentUserId) return null
  if (conversation.type === 'master_supplier') return null
  const parts = conversation.participants ?? []
  const me = parts.find((p) => p.user_id === currentUserId)
  if (me?.role === 'master' || me?.role === 'supplier') return null
  const master = parts.find((p) => p.role === 'master')
  if (!master || master.user_id === currentUserId) return null
  return master.user_id
}
