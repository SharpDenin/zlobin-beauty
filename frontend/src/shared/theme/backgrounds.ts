import { useSyncExternalStore } from 'react'
import { applyAccent } from '@/shared/theme/accent'

export const HOME_BG_STORAGE_KEY = 'zb.home-bg'

export type HomeBackground = {
  id: string
  label: string
  src: string
  /** Base accent. Soft, ink, glow and button gradient are derived. */
  accent: string
  /** Dark photos keep light foreground glass. */
  tone: 'dark'
}

export const HOME_BACKGROUNDS: HomeBackground[] = [
  {
    id: 'forest-water',
    label: 'Лесное озеро',
    src: '/backgrounds/forest-water.jpg',
    accent: '#7EE0C6',
    tone: 'dark',
  },
  {
    id: 'mist-canyon',
    label: 'Туманное ущелье',
    src: '/backgrounds/mist-canyon.jpg',
    accent: '#9FCB9A',
    tone: 'dark',
  },
  {
    id: 'pebble-shore',
    label: 'Каменистый берег',
    src: '/backgrounds/pebble-shore.jpg',
    accent: '#E0B15A',
    tone: 'dark',
  },
]

const listeners = new Set<() => void>()

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

export function getHomeBackground(): HomeBackground {
  return backgroundById(readStoredBackgroundId())
}

export function subscribeHomeBackground(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function setHomeBackground(id: string) {
  const next = backgroundById(id)
  try {
    localStorage.setItem(HOME_BG_STORAGE_KEY, next.id)
  } catch {
    /* ignore quota */
  }
  applyAccent(next.accent)
  document.documentElement.dataset.homeBg = next.id
  listeners.forEach((cb) => cb())
}

export function applyStoredBackground() {
  const bg = getHomeBackground()
  applyAccent(bg.accent)
  if (typeof document !== 'undefined') document.documentElement.dataset.homeBg = bg.id
}

export function useHomeBackground(): HomeBackground {
  const id = useSyncExternalStore(
    subscribeHomeBackground,
    readStoredBackgroundId,
    () => HOME_BACKGROUNDS[0].id,
  )
  return backgroundById(id)
}
