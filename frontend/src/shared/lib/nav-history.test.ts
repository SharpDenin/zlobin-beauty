import { describe, expect, it, beforeEach } from 'vitest'
import {
  canGoBackInApp,
  getNavHistoryDepth,
  isMainNavPath,
  resetNavHistoryForTests,
  trackNavHistory,
} from './nav-history'

describe('nav-history', () => {
  beforeEach(() => {
    resetNavHistoryForTests()
  })

  it('tracks PUSH/POP depth and dedupes the same location key', () => {
    expect(canGoBackInApp()).toBe(false)
    trackNavHistory('PUSH', 'k1')
    trackNavHistory('PUSH', 'k1')
    expect(getNavHistoryDepth()).toBe(1)
    trackNavHistory('PUSH', 'k2')
    expect(getNavHistoryDepth()).toBe(2)
    trackNavHistory('POP', 'k3')
    expect(getNavHistoryDepth()).toBe(1)
    trackNavHistory('REPLACE', 'k4')
    expect(getNavHistoryDepth()).toBe(1)
  })

  it('marks primary destinations as main nav paths', () => {
    expect(isMainNavPath('/')).toBe(true)
    expect(isMainNavPath('/calendar')).toBe(true)
    expect(isMainNavPath('/appointments')).toBe(true)
    expect(isMainNavPath('/services')).toBe(false)
    expect(isMainNavPath('/master')).toBe(false)
  })
})
