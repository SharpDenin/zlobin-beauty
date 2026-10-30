import { useSyncExternalStore } from 'react'
import { applyAccent } from '@/shared/theme/accent'
import { loadMediaBlobUrl } from '@/shared/lib/mediaCache'

export const HOME_BG_STORAGE_KEY = 'zb.home-bg'
export const HOME_BG_MEDIA_STORAGE_KEY = 'zb.home-bg-media'
export const HOME_BG_PREF_KEY = 'ui.home_bg'

export type HomeBackground = {
  id: string
  label: string
  src: string
  /** Base accent. Soft, ink, glow and button gradient are derived. */
  accent: string
  /** Dark photos keep light foreground glass. */
  tone: 'dark'
  /** Custom uploaded wallpaper media id, when source is custom. */
  mediaId?: string
  source: 'system' | 'custom'
}

export type HomeBgPreference =
  | { source: 'system'; id: string }
  | { source: 'custom'; media_id: string }

export const HOME_BACKGROUNDS: HomeBackground[] = [
  {
    id: 'forest-water',
    label: 'Лесное озеро',
    src: '/backgrounds/forest-water.jpg',
    accent: '#7EE0C6',
    tone: 'dark',
    source: 'system',
  },
  {
    id: 'mist-canyon',
    label: 'Туманное ущелье',
    src: '/backgrounds/mist-canyon.jpg',
    accent: '#9FCB9A',
    tone: 'dark',
    source: 'system',
  },
  {
    id: 'pebble-shore',
    label: 'Каменистый берег',
    src: '/backgrounds/pebble-shore.jpg',
    accent: '#E0B15A',
    tone: 'dark',
    source: 'system',
  },
]

const listeners = new Set<() => void>()
let customSrcOverride: string | null = null

export function backgroundById(id: string | null | undefined): HomeBackground {
  return HOME_BACKGROUNDS.find((b) => b.id === id) ?? HOME_BACKGROUNDS[0]
}

export function readStoredBackgroundId(): string {
  try {
    const value = localStorage.getItem(HOME_BG_STORAGE_KEY)
    return backgroundById(value).id
  } catch {
    return HOME_BACKGROUNDS[0].id
  }
}

export function readStoredCustomMediaId(): string | null {
  try {
    const value = localStorage.getItem(HOME_BG_MEDIA_STORAGE_KEY)?.trim()
    return value || null
  } catch {
    return null
  }
}

function notify() {
  listeners.forEach((cb) => cb())
}

function writeSystemId(id: string) {
  try {
    localStorage.setItem(HOME_BG_STORAGE_KEY, id)
  } catch {
    /* ignore quota */
  }
}

function writeCustomMediaId(mediaId: string | null) {
  try {
    if (mediaId) localStorage.setItem(HOME_BG_MEDIA_STORAGE_KEY, mediaId)
    else localStorage.removeItem(HOME_BG_MEDIA_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function preferenceFromStorage(): HomeBgPreference {
  const mediaId = readStoredCustomMediaId()
  if (mediaId) return { source: 'custom', media_id: mediaId }
  return { source: 'system', id: readStoredBackgroundId() }
}

export function parseHomeBgPreference(raw: unknown): HomeBgPreference | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (obj.source === 'custom' && typeof obj.media_id === 'string' && obj.media_id.trim()) {
    return { source: 'custom', media_id: obj.media_id.trim() }
  }
  if (obj.source === 'system' && typeof obj.id === 'string') {
    return { source: 'system', id: backgroundById(obj.id).id }
  }
  // Legacy: bare system id string stored by mistake
  if (typeof (raw as { id?: string }).id === 'string' && !obj.source) {
    return { source: 'system', id: backgroundById((raw as { id: string }).id).id }
  }
  return null
}

function applyVisual(bg: HomeBackground, srcOverride?: string | null) {
  applyAccent(bg.accent)
  if (typeof document === 'undefined') return
  const src = srcOverride || bg.src
  document.documentElement.dataset.homeBg = bg.id
  document.documentElement.style.setProperty('--owner-bg-image', `url('${src}')`)
}

export function getHomeBackground(): HomeBackground {
  const mediaId = readStoredCustomMediaId()
  if (mediaId) {
    const fallback = backgroundById(readStoredBackgroundId())
    return {
      id: `custom:${mediaId}`,
      label: 'Свой фон',
      src: customSrcOverride || fallback.src,
      accent: fallback.accent,
      tone: 'dark',
      mediaId,
      source: 'custom',
    }
  }
  return { ...backgroundById(readStoredBackgroundId()), source: 'system' }
}

export function subscribeHomeBackground(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Select one of the three system wallpapers. */
export function setHomeBackground(id: string) {
  const next = backgroundById(id)
  customSrcOverride = null
  writeCustomMediaId(null)
  writeSystemId(next.id)
  applyVisual(next)
  notify()
}

/** Apply a user-uploaded wallpaper (media already uploaded with purpose=wallpaper). */
export function setCustomHomeBackground(mediaId: string, displaySrc: string) {
  const fallback = backgroundById(readStoredBackgroundId())
  customSrcOverride = displaySrc
  writeCustomMediaId(mediaId)
  // Keep last system id for fallback after delete.
  writeSystemId(fallback.id)
  applyVisual(
    {
      id: `custom:${mediaId}`,
      label: 'Свой фон',
      src: displaySrc,
      accent: fallback.accent,
      tone: 'dark',
      mediaId,
      source: 'custom',
    },
    displaySrc,
  )
  notify()
}

/** Clear custom wallpaper selection and fall back to the default system background. */
export function clearCustomHomeBackground(fallbackSystemId?: string) {
  customSrcOverride = null
  writeCustomMediaId(null)
  const next = backgroundById(fallbackSystemId || HOME_BACKGROUNDS[0].id)
  writeSystemId(next.id)
  applyVisual(next)
  notify()
}

export function applyStoredBackground() {
  const mediaId = readStoredCustomMediaId()
  if (mediaId && customSrcOverride) {
    const fallback = backgroundById(readStoredBackgroundId())
    applyVisual(
      {
        id: `custom:${mediaId}`,
        label: 'Свой фон',
        src: customSrcOverride,
        accent: fallback.accent,
        tone: 'dark',
        mediaId,
        source: 'custom',
      },
      customSrcOverride,
    )
    return
  }
  if (mediaId) {
    // Blob not ready yet — show last system art until hydrateCustomBackground resolves.
    applyVisual(backgroundById(readStoredBackgroundId()))
    return
  }
  applyVisual(backgroundById(readStoredBackgroundId()))
}

/** Load custom wallpaper blob URL when a media id is stored. */
export async function hydrateCustomBackground(): Promise<void> {
  const mediaId = readStoredCustomMediaId()
  if (!mediaId) {
    applyStoredBackground()
    return
  }
  const url = await loadMediaBlobUrl(mediaId)
  if (!url) {
    // Media missing/unauthorized — fall back to system without wiping preference until user deletes.
    applyVisual(backgroundById(readStoredBackgroundId()))
    notify()
    return
  }
  customSrcOverride = url
  applyStoredBackground()
  notify()
}

export function applyHomeBgPreference(pref: HomeBgPreference) {
  if (pref.source === 'system') {
    setHomeBackground(pref.id)
    return
  }
  writeCustomMediaId(pref.media_id)
  void hydrateCustomBackground()
}

export function useHomeBackground(): HomeBackground {
  const snapshot = useSyncExternalStore(
    subscribeHomeBackground,
    () => {
      const bg = getHomeBackground()
      return `${bg.id}|${bg.src}|${bg.mediaId ?? ''}`
    },
    () => HOME_BACKGROUNDS[0].id,
  )
  void snapshot
  return getHomeBackground()
}
