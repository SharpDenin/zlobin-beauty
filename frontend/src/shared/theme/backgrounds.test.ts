import { beforeEach, describe, expect, it } from 'vitest'
import {
  HOME_BACKGROUNDS,
  HOME_BG_MEDIA_STORAGE_KEY,
  HOME_BG_STORAGE_KEY,
  backgroundById,
  clearCustomHomeBackground,
  parseHomeBgPreference,
  preferenceFromStorage,
  setHomeBackground,
} from './backgrounds'

describe('home backgrounds', () => {
  beforeEach(() => {
    localStorage.clear()
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
})
