import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import { apiRequest } from '@/shared/api/client'
import {
  HOME_BG_PREF_KEY,
  applyHomeBgPreference,
  parseHomeBgPreference,
} from '@/shared/theme/backgrounds'

/**
 * After login, server ui.home_bg wins over stale localStorage wallpaper keys.
 * If the preference is absent, local device selection is left unchanged.
 */
export function HomeBackgroundPreferenceSync() {
  const { accessToken } = useAuth()
  const applied = useRef<string | null>(null)

  const prefs = useQuery({
    queryKey: ['me-preferences'],
    queryFn: () => apiRequest<{ preferences: Record<string, unknown> }>('/v1/me/preferences', { token: accessToken }),
    enabled: Boolean(accessToken),
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!accessToken || !prefs.data?.preferences) return
    const raw = prefs.data.preferences[HOME_BG_PREF_KEY]
    if (raw === undefined) return
    const parsed = parseHomeBgPreference(raw)
    if (!parsed) return
    const signature = JSON.stringify(parsed)
    if (applied.current === signature) return
    applied.current = signature
    applyHomeBgPreference(parsed)
  }, [accessToken, prefs.data])

  return null
}
