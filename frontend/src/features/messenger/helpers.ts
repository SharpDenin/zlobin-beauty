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
      return 'Мастер-класс'
    case 'model_request':
      return 'Модели'
    default:
      return 'Диалог'
  }
}

export function lastMessagePreview(msg?: Pick<ChatMessage, 'body' | 'kind'> | null) {
  const body = msg?.body?.trim() ?? ''
  if (body) return body
  if (msg?.kind === 'video') return 'Видео'
  if (msg?.kind === 'image') return 'Фото'
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

export const DESKTOP_MESSENGER_MQ = '(min-width: 768px)'

export function isDesktopMessenger() {
  return typeof window !== 'undefined' && window.matchMedia(DESKTOP_MESSENGER_MQ).matches
}
