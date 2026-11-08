import { describe, expect, it } from 'vitest'
import {
  groupBubbleNotifications,
  isAppointmentNotification,
  isChatNotification,
  type NotificationRow,
} from '@/features/notifications/groupBubbleNotifications'

function row(partial: Partial<NotificationRow> & Pick<NotificationRow, 'id'>): NotificationRow {
  return {
    type: 'info',
    title: 't',
    body: 'b',
    entity_type: 'appointment',
    entity_id: null,
    read_at: null,
    created_at: '2026-08-30T10:00:00.000Z',
    ...partial,
  }
}

describe('groupBubbleNotifications', () => {
  it('keeps one bubble per conversation with messenger unread count', () => {
    const items = [
      row({
        id: 'm1',
        type: 'new_message',
        title: 'Новое сообщение от Анна',
        body: 'первое',
        entity_type: 'conversation',
        entity_id: 'c1',
        created_at: '2026-08-30T10:00:00.000Z',
      }),
      row({
        id: 'm2',
        type: 'new_message',
        title: 'Новое сообщение от Анна',
        body: 'второе',
        entity_type: 'conversation',
        entity_id: 'c1',
        created_at: '2026-08-30T11:00:00.000Z',
      }),
      row({
        id: 'm3',
        type: 'new_message',
        title: 'Новое сообщение от Борис',
        body: 'привет',
        entity_type: 'conversation',
        entity_id: 'c2',
        created_at: '2026-08-30T10:30:00.000Z',
      }),
      row({
        id: 'a1',
        type: 'appointment.confirmed',
        title: 'Запись подтверждена',
        entity_type: 'appointment',
        entity_id: 'ap1',
        created_at: '2026-08-30T09:00:00.000Z',
      }),
    ]

    const grouped = groupBubbleNotifications(items, { c1: 3, c2: 1 })
    expect(grouped).toHaveLength(3)
    expect(grouped[0].groupKey).toBe('conversation:c1')
    expect(grouped[0].body).toBe('второе')
    expect(grouped[0].messageCount).toBe(3)
    expect(grouped[0].groupIds).toEqual(['m2', 'm1'])
    expect(grouped[1].groupKey).toBe('conversation:c2')
    expect(grouped[1].messageCount).toBe(1)
    expect(grouped[2].groupKey).toBe('notification:a1')
    expect(grouped[2].messageCount).toBeUndefined()
  })

  it('drops chat bubbles when messenger unread is zero', () => {
    const items = [
      row({
        id: 'm1',
        type: 'new_message',
        entity_type: 'conversation',
        entity_id: 'c1',
        read_at: null,
      }),
    ]
    expect(groupBubbleNotifications(items, { c1: 0 })).toEqual([])
  })

  it('falls back to unread notification count when messenger map is empty', () => {
    const items = [
      row({
        id: 'm1',
        type: 'new_message',
        entity_type: 'conversation',
        entity_id: 'c1',
        read_at: null,
        created_at: '2026-08-30T10:00:00.000Z',
      }),
      row({
        id: 'm2',
        type: 'new_message',
        entity_type: 'conversation',
        entity_id: 'c1',
        read_at: null,
        created_at: '2026-08-30T11:00:00.000Z',
      }),
    ]
    const grouped = groupBubbleNotifications(items, {})
    expect(grouped).toHaveLength(1)
    expect(grouped[0].messageCount).toBe(2)
  })
})

describe('notification classifiers', () => {
  it('detects chat vs appointment by entity_type', () => {
    expect(isChatNotification({ entity_type: 'conversation' })).toBe(true)
    expect(isChatNotification({ type: 'new_message' })).toBe(true)
    expect(isChatNotification({ entity_type: 'appointment' })).toBe(false)
    expect(isAppointmentNotification({ entity_type: 'appointment' })).toBe(true)
    expect(isAppointmentNotification({ entity_type: 'conversation' })).toBe(false)
  })
})
