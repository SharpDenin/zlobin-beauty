import { describe, expect, it } from 'vitest'
import { weekStartFromDate } from '@/pages/CalendarMastersWeek'

describe('weekStartFromDate', () => {
  it('returns Monday of the week containing the anchor', () => {
    // Wednesday 2026-11-18 local
    const wed = new Date(2026, 10, 18, 15, 0, 0)
    const start = weekStartFromDate(wed, 'Europe/Moscow')
    expect(start.getDay()).toBe(1)
    expect(start.getDate()).toBe(16)
  })
})
