import { describe, expect, it } from 'vitest'
import { resolveTheme } from '@/shared/theme/theme'

describe('resolveTheme', () => {
  it('prefers an explicit stored choice over the system theme', () => {
    expect(resolveTheme('light', 'dark')).toBe('light')
    expect(resolveTheme('dark', 'light')).toBe('dark')
  })

  it('falls back to the system theme until the user chooses', () => {
    expect(resolveTheme(null, 'light')).toBe('light')
    expect(resolveTheme('', 'dark')).toBe('dark')
    expect(resolveTheme('system', 'dark')).toBe('dark')
  })
})
