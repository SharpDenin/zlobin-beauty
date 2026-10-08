import { describe, expect, it } from 'vitest'
import { formatFormulaComponent } from '@/pages/ClientCardPage'

describe('formatFormulaComponent', () => {
  it('reads seed components stored as code and grams', () => {
    expect(formatFormulaComponent({ code: '7.1', grams: 30 })).toBe('7.1 · 30 г')
    expect(formatFormulaComponent({ label: 'Majirel', amount: '20 г' })).toBe('Majirel · 20 г')
  })
})
