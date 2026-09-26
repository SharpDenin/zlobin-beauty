import { describe, expect, it } from 'vitest'
import {
  canJoinMultiService,
  confirmLegsFromPlan,
  formatVisitMinutes,
  groupAppointmentsByVisit,
  salonCompanionServices,
  swapServiceOrder,
  visitGroupPrice,
  visitGroupTitle,
  type VisitPlan,
} from './visit-plan-helpers'

const plan: VisitPlan = {
  starts_at: '2026-09-01T03:00:00.000Z',
  ends_at: '2026-09-01T05:10:00.000Z',
  wait_minutes: 0,
  total_minutes: 130,
  same_master: false,
  legs: [
    {
      service_id: 's1',
      service_name: 'Стрижка',
      master_id: 'm1',
      master_user_id: 'u1',
      master_display_name: 'Анна',
      starts_at: '2026-09-01T03:00:00.000Z',
      ends_at: '2026-09-01T03:40:00.000Z',
      duration_minutes: 40,
      price_minor: 350000,
    },
    {
      service_id: 's2',
      service_name: 'Окрашивание',
      master_id: 'm2',
      master_user_id: 'u2',
      master_display_name: 'Ольга',
      starts_at: '2026-09-01T03:40:00.000Z',
      ends_at: '2026-09-01T05:10:00.000Z',
      duration_minutes: 90,
      price_minor: 650000,
    },
  ],
}

describe('visit-plan-helpers', () => {
  it('allows a second flexible service and hides fixed windows', () => {
    expect(canJoinMultiService({ booking_mode: 'flexible' })).toBe(true)
    expect(canJoinMultiService({ booking_mode: 'fixed_window' })).toBe(false)
    expect(salonCompanionServices([
      { id: 'a', name: 'Стрижка', duration_minutes: 40, price_minor: 1, booking_mode: 'flexible' },
      { id: 'b', name: 'МК', duration_minutes: 240, price_minor: 1, booking_mode: 'fixed_window' },
      { id: 'c', name: 'Окрашивание', duration_minutes: 90, price_minor: 1 },
    ], 'a').map((s) => s.id)).toEqual(['c'])
  })

  it('formats visit duration and confirm payload', () => {
    expect(formatVisitMinutes(130)).toBe('2 ч 10 мин')
    expect(formatVisitMinutes(60)).toBe('1 ч')
    expect(confirmLegsFromPlan(plan)).toEqual([
      { service_id: 's1', master_id: 'm1', starts_at: '2026-09-01T03:00:00.000Z' },
      { service_id: 's2', master_id: 'm2', starts_at: '2026-09-01T03:40:00.000Z' },
    ])
    expect(swapServiceOrder(['s1', 's2'])).toEqual(['s2', 's1'])
  })

  it('groups related appointments for the list', () => {
    const groups = groupAppointmentsByVisit([
      { id: '1', service_name: 'Стрижка', status: 'confirmed', starts_at: '2026-09-01T10:00:00Z', price_minor: 100, visit_group_id: 'g1' },
      { id: '2', service_name: 'Окрашивание', status: 'confirmed', starts_at: '2026-09-01T10:40:00Z', price_minor: 200, visit_group_id: 'g1' },
      { id: '3', service_name: 'Уход', status: 'confirmed', starts_at: '2026-09-02T10:00:00Z', price_minor: 50 },
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].combined).toBe(true)
    expect(visitGroupTitle(groups[0])).toBe('Стрижка + Окрашивание')
    expect(visitGroupPrice(groups[0])).toBe(300)
    expect(groups[1].combined).toBe(false)
  })
})
