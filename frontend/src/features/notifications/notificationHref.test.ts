import { describe, expect, it } from 'vitest'
import { notificationHref } from './notificationHref'

describe('notificationHref', () => {
  it('routes hair consultation notifications', () => {
    expect(notificationHref({ entity_type: 'hair_consultation', entity_id: 'abc' })).toBe('/consultations/abc')
  })

  it('falls back for unknown types', () => {
    expect(notificationHref({ entity_type: 'other', entity_id: '1' })).toBe('/notifications')
  })
})
