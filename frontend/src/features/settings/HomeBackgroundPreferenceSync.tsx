import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import { apiRequest } from '@/shared/api/client'
import {
  HOME_BG_PREF_KEY,
  HOME_BACKGROUNDS,
  applyHomeBgPreference,
  applyStoredBackground,
  bindWallpaperUser,
  parseHomeBgPreference,
  setHomeBackground,
} from '@/shared/theme/backgrounds'

/**
 * After login, server ui.home_bg wins over device-scoped wallpaper keys.
 * If the preference is absent, keep this user's scoped selection (or default) —
 * never leave another account's wallpaper on screen.
 */
export function HomeBackgroundPreferenceSync() {
  const { accessToken, user } = useAuth()
  const applied = useRef<string | null>(null)

  useEffect(() => {
    if (!user?.id) return
    bindWallpaperUser(user.id)
  }, [user?.id])

  const prefs = useQuery({
    queryKey: ['me-preferences'],
    queryFn: () => apiRequest<{ preferences: Record<string, unknown> }>('/v1/me/preferences', { token: accessToken }),
    enabled: Boolean(accessToken),
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!accessToken || !prefs.data?.preferences || !user?.id) return
    const raw = prefs.data.preferences[HOME_BG_PREF_KEY]
    if (raw === undefined) {
      // No server wallpaper → user-scoped local (or default). Re-apply so we never keep a prior account frame.
      const signature = `local:${user.id}`
      if (applied.current === signature) return
      applied.current = signature
      applyStoredBackground()
      return
    }
    const parsed = parseHomeBgPreference(raw)
    if (!parsed) {
      setHomeBackground(HOME_BACKGROUNDS[0].id)
      applied.current = `default:${user.id}`
      return
    }
    const signature = `${user.id}:${JSON.stringify(parsed)}`
    if (applied.current === signature) return
    applied.current = signature
    applyHomeBgPreference(parsed)
  }, [accessToken, prefs.data, user?.id])

  return null
}
