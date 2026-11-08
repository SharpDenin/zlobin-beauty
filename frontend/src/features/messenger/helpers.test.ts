import { describe, expect, it } from 'vitest'
import {
  bookingMasterUserId,
  canSendMessage,
  conversationTypeLabel,
  emptyMessengerAction,
  isNearBottom,
  lastMessagePreview,
  MAX_MESSAGE_CHARS,
  peerInitials,
} from '@/features/messenger/helpers'

describe('messenger helpers', () => {
  it('labels conversation types in Russian', () => {
    expect(conversationTypeLabel('client_master')).toBe('Клиент и мастер')
    expect(conversationTypeLabel('master_supplier')).toBe('Мастер и поставщик')
  })

  it('previews last message by kind when body is empty', () => {
    expect(lastMessagePreview({ body: 'Привет', kind: 'text' })).toBe('Привет')
    expect(lastMessagePreview({ body: '', kind: 'image' })).toBe('Фото')
    expect(lastMessagePreview({ body: '  ', kind: 'video' })).toBe('Видео')
    expect(lastMessagePreview(null)).toBe('Нет сообщений')
  })

  it('builds initials and send rules', () => {
    expect(peerInitials('Анна Волкова')).toBe('АВ')
    expect(peerInitials('')).toBe('?')
    expect(canSendMessage('  ', null)).toBe(false)
    expect(canSendMessage('', new File(['x'], 'a.jpg', { type: 'image/jpeg' }))).toBe(true)
    expect(canSendMessage('ok', null)).toBe(true)
    expect(canSendMessage('я'.repeat(MAX_MESSAGE_CHARS + 1), null)).toBe(false)
  })

  it('offers a role-specific empty action', () => {
    expect(emptyMessengerAction('client')).toEqual({ label: 'Напишите мастеру', to: '/search' })
    expect(emptyMessengerAction('private_master')).toEqual({ label: 'Связаться с поставщиком', to: '/cosmetics' })
    expect(emptyMessengerAction('supplier')).toBeNull()
  })

  it('detects near-bottom scroll without jumping', () => {
    const el = {
      scrollHeight: 1000,
      scrollTop: 900,
      clientHeight: 80,
    } as HTMLElement
    expect(isNearBottom(el)).toBe(true)
    el.scrollTop = 10
    expect(isNearBottom(el)).toBe(false)
  })

  it('resolves booking master for client/model chats, not for master or supplier side', () => {
    const conv = {
      type: 'client_master',
      participants: [
        { user_id: 'client-1', role: 'client' },
        { user_id: 'master-1', role: 'master' },
      ],
    }
    expect(bookingMasterUserId(conv, 'client-1')).toBe('master-1')
    expect(bookingMasterUserId(conv, 'master-1')).toBeNull()
    expect(bookingMasterUserId({ ...conv, type: 'model_request' }, 'client-1')).toBe('master-1')
    expect(bookingMasterUserId({ ...conv, type: 'master_supplier' }, 'client-1')).toBeNull()
    expect(bookingMasterUserId(conv, undefined)).toBeNull()
  })
})
