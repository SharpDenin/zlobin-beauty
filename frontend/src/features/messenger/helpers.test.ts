import { describe, expect, it } from 'vitest'
import { compareMessages, mergeConversationMessages, messageDedupeKey } from '@/features/messenger/helpers'
import type { ChatMessage } from '@/features/messenger/types'

function msg(partial: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'created_at'>): ChatMessage {
  return {
    sender_user_id: 'u1',
    kind: 'text',
    body: partial.body ?? partial.id,
    ...partial,
  }
}

describe('messenger message order + merge', () => {
  it('orders by created_at then id when timestamps collide', () => {
    const a = msg({ id: 'b', created_at: '2026-08-30T10:00:00.000Z' })
    const b = msg({ id: 'a', created_at: '2026-08-30T10:00:00.000Z' })
    const c = msg({ id: 'c', created_at: '2026-08-30T10:00:01.000Z' })
    expect([a, c, b].sort(compareMessages).map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })

  it('dedupes optimistic local against server client_id', () => {
    const server = [
      msg({ id: 'srv-1', client_id: 'local-1', created_at: '2026-08-30T10:00:02.000Z', body: 'hi' }),
    ]
    const local = [
      msg({
        id: 'local-1',
        client_id: 'local-1',
        created_at: '2026-08-30T10:00:01.500Z',
        body: 'hi',
        status: 'sending',
      }),
    ]
    const merged = mergeConversationMessages([], server, local)
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('srv-1')
    expect(merged[0].status).toBe('sent')
  })

  it('keeps failed optimistic messages and appends newer server rows in order', () => {
    const older = [msg({ id: 'm0', created_at: '2026-08-30T09:00:00.000Z', body: 'old' })]
    const server = [msg({ id: 'm2', created_at: '2026-08-30T10:00:02.000Z', body: 'ok' })]
    const local = [
      msg({
        id: 'local-fail',
        client_id: 'local-fail',
        created_at: '2026-08-30T10:00:01.000Z',
        body: 'fail',
        status: 'failed',
      }),
    ]
    const merged = mergeConversationMessages(older, server, local)
    expect(merged.map((m) => m.id)).toEqual(['m0', 'local-fail', 'm2'])
    expect(messageDedupeKey(local[0])).toBe('c:local-fail')
  })

  it('does not duplicate the same id from older + server pages', () => {
    const row = msg({ id: 'm1', created_at: '2026-08-30T10:00:00.000Z' })
    const merged = mergeConversationMessages([row], [row], [])
    expect(merged).toHaveLength(1)
  })
})
