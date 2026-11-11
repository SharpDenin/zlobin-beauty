import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HOME_BACKGROUNDS,
  HOME_BG_ACCENT_STORAGE_KEY,
  HOME_BG_MEDIA_STORAGE_KEY,
  HOME_BG_STORAGE_KEY,
  WALLPAPER_ACTIVE_USER_KEY,
  backgroundById,
  bindWallpaperUser,
  clearCustomHomeBackground,
  clearWallpaperSession,
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
    bindWallpaperUser('user-a')
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

  it('stores system wallpaper under the active user scope', () => {
    setHomeBackground('pebble-shore')
    expect(localStorage.getItem('zb.wallpaper.user-a.bg')).toBe('pebble-shore')
    expect(localStorage.getItem('zb.wallpaper.user-a.media')).toBeNull()
    expect(localStorage.getItem(HOME_BG_STORAGE_KEY)).toBeNull()
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
    localStorage.setItem('zb.wallpaper.user-a.media', 'media-1')
    clearCustomHomeBackground()
    expect(localStorage.getItem('zb.wallpaper.user-a.media')).toBeNull()
    expect(localStorage.getItem('zb.wallpaper.user-a.bg')).toBe(HOME_BACKGROUNDS[0].id)
  })

  it('isolates wallpapers between accounts and resets on logout', () => {
    setHomeBackground('mist-canyon')
    expect(document.documentElement.dataset.homeBg).toBe('mist-canyon')

    bindWallpaperUser('user-b')
    expect(getHomeBackground().id).toBe(HOME_BACKGROUNDS[0].id)
    expect(document.documentElement.dataset.homeBg).toBe(HOME_BACKGROUNDS[0].id)
    setHomeBackground('pebble-shore')

    bindWallpaperUser('user-a')
    expect(getHomeBackground().id).toBe('mist-canyon')

    clearWallpaperSession()
    expect(localStorage.getItem(WALLPAPER_ACTIVE_USER_KEY)).toBeNull()
    expect(document.documentElement.dataset.homeBg).toBe(HOME_BACKGROUNDS[0].id)
    // Previous account data remains for re-login, but is not active.
    expect(localStorage.getItem('zb.wallpaper.user-a.bg')).toBe('mist-canyon')
    expect(localStorage.getItem('zb.wallpaper.user-b.bg')).toBe('pebble-shore')
  })

  it('does not apply legacy global zb.home-bg to a new account', () => {
    localStorage.setItem(HOME_BG_STORAGE_KEY, 'mist-canyon')
    bindWallpaperUser('user-c')
    expect(getHomeBackground().id).toBe(HOME_BACKGROUNDS[0].id)
    expect(localStorage.getItem(HOME_BG_STORAGE_KEY)).toBeNull()
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
