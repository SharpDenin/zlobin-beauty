import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HOME_BACKGROUNDS,
  HOME_BG_ACCENT_STORAGE_KEY,
  HOME_BG_MEDIA_STORAGE_KEY,
  HOME_BG_STORAGE_KEY,
  backgroundById,
  clearCustomHomeBackground,
  getHomeBackground,
  parseHomeBgPreference,
  preferenceFromStorage,
  readCachedAccent,
  setHomeBackground,
  wallpaperAccentKey,
  writeCachedAccent,
} from './backgrounds'

vi.mock('@/shared/theme/extractWallpaperAccent', () => ({
  extractDominantAccent: vi.fn(async () => null),
}))

describe('home backgrounds', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.dataset.theme = 'dark'
  })

  it('falls back to the first system background', () => {
    expect(backgroundById('missing').id).toBe(HOME_BACKGROUNDS[0].id)
  })

  it('parses system and custom preference payloads', () => {
    expect(parseHomeBgPreference({ source: 'system', id: 'mist-canyon' })).toEqual({
      source: 'system',
      id: 'mist-canyon',
    })
    expect(parseHomeBgPreference({ source: 'custom', media_id: 'abc' })).toEqual({
      source: 'custom',
      media_id: 'abc',
    })
    expect(parseHomeBgPreference(null)).toBeNull()
  })

  it('keeps legacy system id in localStorage when selecting a system wallpaper', () => {
    setHomeBackground('pebble-shore')
    expect(localStorage.getItem(HOME_BG_STORAGE_KEY)).toBe('pebble-shore')
    expect(localStorage.getItem(HOME_BG_MEDIA_STORAGE_KEY)).toBeNull()
    expect(preferenceFromStorage()).toEqual({ source: 'system', id: 'pebble-shore' })
  })

  it('writes --app-bg-image and keeps --owner-bg-image alias in sync', () => {
    setHomeBackground('mist-canyon')
    const root = document.documentElement.style
    expect(root.getPropertyValue('--app-bg-image')).toBe("url('/backgrounds/mist-canyon.jpg')")
    expect(root.getPropertyValue('--owner-bg-image')).toBe("url('/backgrounds/mist-canyon.jpg')")
  })

  it('falls back to default system wallpaper after clearing custom', () => {
    localStorage.setItem(HOME_BG_MEDIA_STORAGE_KEY, 'media-1')
    clearCustomHomeBackground()
    expect(localStorage.getItem(HOME_BG_MEDIA_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(HOME_BG_STORAGE_KEY)).toBe(HOME_BACKGROUNDS[0].id)
  })

  it('persists wallpaper accent cache and restores it on selection', () => {
    const key = wallpaperAccentKey({ source: 'system', id: 'pebble-shore' })
    writeCachedAccent(key, '#D4A017')
    expect(readCachedAccent(key)).toBe('#D4A017')
    setHomeBackground('pebble-shore')
    expect(getHomeBackground().accent).toBe('#D4A017')
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBeTruthy()
    const raw = localStorage.getItem(HOME_BG_ACCENT_STORAGE_KEY)
    expect(raw).toContain('pebble-shore')
    expect(raw).toContain('#D4A017')
  })

  it('applies curated accent immediately when cache is empty', () => {
    setHomeBackground('mist-canyon')
    expect(getHomeBackground().accent).toBe(HOME_BACKGROUNDS.find((b) => b.id === 'mist-canyon')!.accent)
  })
})
