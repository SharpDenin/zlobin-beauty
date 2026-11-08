import { useSyncExternalStore } from 'react'
import { applyAccent, DEFAULT_UI_ACCENT, readDocumentTheme } from '@/shared/theme/accent'
import { extractDominantAccent } from '@/shared/theme/extractWallpaperAccent'
import { loadMediaBlobUrl } from '@/shared/lib/mediaCache'

export const HOME_BG_STORAGE_KEY = 'zb.home-bg'
export const HOME_BG_MEDIA_STORAGE_KEY = 'zb.home-bg-media'
export const HOME_BG_ACCENT_STORAGE_KEY = 'zb.home-bg-accent'
export const HOME_BG_PREF_KEY = 'ui.home_bg'

export type HomeBackground = {
  id: string
  label: string
  src: string
  /** Base accent (curated or extracted). Soft, ink, glow and button gradient are derived. */
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

type AccentCache = {
  v: 1
  map: Record<string, string>
  activeKey: string | null
}

const listeners = new Set<() => void>()
let customSrcOverride: string | null = null
/** Monotonic generation — drop stale async extract results. */
let accentExtractGeneration = 0
/** Wallpaper keys currently being analyzed (dedupe concurrent extract). */
const accentExtractInFlight = new Set<string>()

export function backgroundById(id: string | null | undefined): HomeBackground {
  return HOME_BACKGROUNDS.find((b) => b.id === id) ?? HOME_BACKGROUNDS[0]
}

export function wallpaperAccentKey(bg: Pick<HomeBackground, 'source' | 'id' | 'mediaId'>): string {
  if (bg.source === 'custom' && bg.mediaId) return `custom:${bg.mediaId}`
  return `system:${bg.id.startsWith('custom:') ? readStoredBackgroundId() : bg.id}`
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

function emptyAccentCache(): AccentCache {
  return { v: 1, map: {}, activeKey: null }
}

function readAccentCache(): AccentCache {
  try {
    const raw = localStorage.getItem(HOME_BG_ACCENT_STORAGE_KEY)
    if (!raw) return emptyAccentCache()
    const parsed = JSON.parse(raw) as Partial<AccentCache>
    if (parsed?.v !== 1 || !parsed.map || typeof parsed.map !== 'object') return emptyAccentCache()
    return {
      v: 1,
      map: parsed.map as Record<string, string>,
      activeKey: typeof parsed.activeKey === 'string' ? parsed.activeKey : null,
    }
  } catch {
    return emptyAccentCache()
  }
}

function writeAccentCache(cache: AccentCache) {
  try {
    localStorage.setItem(HOME_BG_ACCENT_STORAGE_KEY, JSON.stringify(cache))
  } catch {
    /* ignore quota */
  }
}

function isHexColor(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim())
}

export function readCachedAccent(key: string): string | null {
  const hex = readAccentCache().map[key]
  return isHexColor(hex) ? hex : null
}

export function writeCachedAccent(key: string, hex: string) {
  if (!isHexColor(hex)) return
  const cache = readAccentCache()
  cache.map[key] = hex.trim()
  cache.activeKey = key
  writeAccentCache(cache)
}

function markActiveAccentKey(key: string) {
  const cache = readAccentCache()
  if (cache.activeKey === key) return
  cache.activeKey = key
  writeAccentCache(cache)
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

/** Canonical CSS var for the app wallpaper. `--owner-bg-image` remains as a compatibility alias. */
export const APP_BG_IMAGE_VAR = '--app-bg-image'
/** @deprecated Prefer `--app-bg-image`; kept for owner-home and legacy CSS. */
export const OWNER_BG_IMAGE_VAR = '--owner-bg-image'

function resolveAccentForBackground(bg: HomeBackground): string {
  const key = wallpaperAccentKey(bg)
  const cached = readCachedAccent(key)
  if (cached) return cached
  if (bg.source === 'system' && isHexColor(bg.accent)) return bg.accent
  return DEFAULT_UI_ACCENT
}

/**
 * Kick off client-side image analysis once per wallpaper key.
 * Cached / curated accent is already applied synchronously — this only refines.
 */
function scheduleAccentExtraction(bg: HomeBackground, src: string) {
  if (typeof document === 'undefined') return
  const key = wallpaperAccentKey(bg)
  if (readCachedAccent(key)) {
    markActiveAccentKey(key)
    return
  }
  if (accentExtractInFlight.has(key)) return
  accentExtractInFlight.add(key)
  const generation = ++accentExtractGeneration

  void (async () => {
    try {
      const raw = await extractDominantAccent(src)
      // Persist even if a newer extract started — otherwise a raced applyVisual
      // can leave the cache empty forever after an early generation return.
      const hex = raw && isHexColor(raw) ? raw : bg.source === 'system' && isHexColor(bg.accent) ? bg.accent : DEFAULT_UI_ACCENT
      if (!readCachedAccent(key)) writeCachedAccent(key, hex)
      if (generation !== accentExtractGeneration) return
      writeCachedAccent(key, hex)
      const current = getHomeBackground()
      if (wallpaperAccentKey(current) !== key) return
      applyAccent(hex, readDocumentTheme())
      notify()
    } catch {
      const fallback = bg.source === 'system' && isHexColor(bg.accent) ? bg.accent : DEFAULT_UI_ACCENT
      if (!readCachedAccent(key)) writeCachedAccent(key, fallback)
      if (generation !== accentExtractGeneration) return
      writeCachedAccent(key, fallback)
    } finally {
      accentExtractInFlight.delete(key)
    }
  })()
}

function applyVisual(bg: HomeBackground, srcOverride?: string | null, opts?: { extract?: boolean }) {
  const src = srcOverride || bg.src
  const accent = resolveAccentForBackground(bg)
  const key = wallpaperAccentKey(bg)
  markActiveAccentKey(key)
  applyAccent(accent, readDocumentTheme())
  if (typeof document !== 'undefined') {
    const value = `url('${src}')`
    const root = document.documentElement
    root.dataset.homeBg = bg.id
    // Primary global token used by body::before atmosphere…
    root.style.setProperty(APP_BG_IMAGE_VAR, value)
    // …and legacy alias for any remaining --owner-bg-image consumers.
    root.style.setProperty(OWNER_BG_IMAGE_VAR, value)
  }
  if (opts?.extract !== false) {
    scheduleAccentExtraction({ ...bg, accent }, src)
  }
}

export function getHomeBackground(): HomeBackground {
  const mediaId = readStoredCustomMediaId()
  if (mediaId) {
    const fallback = backgroundById(readStoredBackgroundId())
    const partial = {
      id: `custom:${mediaId}`,
      label: 'Свой фон',
      src: customSrcOverride || fallback.src,
      accent: fallback.accent,
      tone: 'dark' as const,
      mediaId,
      source: 'custom' as const,
    }
    return { ...partial, accent: resolveAccentForBackground(partial) }
  }
  const system = { ...backgroundById(readStoredBackgroundId()), source: 'system' as const }
  return { ...system, accent: resolveAccentForBackground(system) }
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
    // Do not extract from the wrong photo.
    applyVisual(backgroundById(readStoredBackgroundId()), undefined, { extract: false })
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
      return `${bg.id}|${bg.src}|${bg.mediaId ?? ''}|${bg.accent}`
    },
    () => HOME_BACKGROUNDS[0].id,
  )
  void snapshot
  return getHomeBackground()
}
