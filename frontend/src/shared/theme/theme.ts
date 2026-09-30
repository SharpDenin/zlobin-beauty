export const THEME_STORAGE_KEY = 'zb.theme'

export type ThemeChoice = 'light' | 'dark'

export function isThemeChoice(value: string | null | undefined): value is ThemeChoice {
  return value === 'light' || value === 'dark'
}

export function systemTheme(): ThemeChoice {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function resolveTheme(stored: string | null | undefined, system: ThemeChoice = 'dark'): ThemeChoice {
  if (isThemeChoice(stored)) return stored
  return system
}

export function applyTheme(theme: ThemeChoice) {
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'light' ? '#F3F5FA' : '#0B0D12')
}

export function readStoredTheme(): ThemeChoice | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeChoice(value) ? value : null
  } catch {
    return null
  }
}

export function writeStoredTheme(theme: ThemeChoice) {
  localStorage.setItem(THEME_STORAGE_KEY, theme)
}
