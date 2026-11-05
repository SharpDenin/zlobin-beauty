import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { apiRequest } from '@/shared/api/client'
import { userError } from '@/shared/lib/app-error'
import { usePreference } from '@/shared/lib/preferences'
import { uploadMedia, MEDIA_ACCEPT_IMAGES, validateMediaFile } from '@/shared/lib/mediaUpload'
import { loadMediaBlobUrl } from '@/shared/lib/mediaCache'
import { ThemeToggle } from '@/shared/ui/ThemeToggle'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import {
  HOME_BACKGROUNDS,
  HOME_BG_PREF_KEY,
  type HomeBgPreference,
  clearCustomHomeBackground,
  parseHomeBgPreference,
  preferenceFromStorage,
  setCustomHomeBackground,
  setHomeBackground,
  useHomeBackground,
} from '@/shared/theme/backgrounds'

export function SettingsAppearancePage() {
  const { accessToken } = useAuth()
  const background = useHomeBackground()
  const fallbackPref = useMemo(() => preferenceFromStorage(), [])
  const [pref, setPref] = usePreference<HomeBgPreference>(HOME_BG_PREF_KEY, fallbackPref)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const hydratedRemote = useRef(false)

  useEffect(() => {
    const parsed = parseHomeBgPreference(pref)
    if (!parsed) return
    if (!hydratedRemote.current) {
      hydratedRemote.current = true
      if (parsed.source === 'system') setHomeBackground(parsed.id)
      else void (async () => {
        const url = await loadMediaBlobUrl(parsed.media_id)
        if (url) setCustomHomeBackground(parsed.media_id, url)
      })()
      return
    }
  }, [pref])

  function selectSystem(id: string) {
    setError(null)
    setOk(null)
    setHomeBackground(id)
    setPref({ source: 'system', id })
    setOk('Системный фон сохранён')
  }

  async function onUpload(file: File | undefined) {
    if (!file || !accessToken) return
    setError(null)
    setOk(null)
    const invalid = validateMediaFile(file, { allowGif: false, allowVideo: false })
    if (invalid) {
      setError(invalid)
      return
    }
    setUploading(true)
    try {
      const previousMedia = background.source === 'custom' ? background.mediaId : null
      const uploaded = await uploadMedia(file, 'wallpaper', accessToken, undefined, { allowGif: false, allowVideo: false })
      const url = await loadMediaBlobUrl(uploaded.id)
      if (!url) throw new Error('preview')
      setCustomHomeBackground(uploaded.id, url)
      setPref({ source: 'custom', media_id: uploaded.id })
      setOk('Свой фон загружен')
      if (previousMedia && previousMedia !== uploaded.id) {
        try {
          await apiRequest(`/v1/media/${previousMedia}`, { method: 'DELETE', token: accessToken })
        } catch {
          /* orphan cleanup best-effort */
        }
      }
    } catch (e) {
      setError(userError(e, 'Не удалось загрузить фон'))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function onDeleteCustom() {
    const fallback = { source: 'system' as const, id: HOME_BACKGROUNDS[0].id }
    if (!accessToken || background.source !== 'custom' || !background.mediaId) {
      clearCustomHomeBackground(fallback.id)
      setPref(fallback)
      setOk('Применён фон по умолчанию')
      return
    }
    setDeleting(true)
    setError(null)
    setOk(null)
    const mediaId = background.mediaId
    try {
      try {
        await apiRequest(`/v1/media/${mediaId}`, { method: 'DELETE', token: accessToken })
      } catch {
        // Already gone / not owned — still clear local + preference so no broken link remains.
      }
      clearCustomHomeBackground(fallback.id)
      setPref(fallback)
      setOk('Свой фон удалён. Применён фон по умолчанию.')
    } catch (e) {
      setError(userError(e, 'Не удалось удалить фон'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="stack" data-testid="settings-appearance">
      <section className="card stack">
        <h2>Тема</h2>
        <p className="muted">Светлая или тёмная тема применяется сразу и сохраняется на этом устройстве.</p>
        <ThemeToggle labelled />
      </section>

      <section className="card stack">
        <h2>Фон главной</h2>
        <p className="muted">Системные варианты и собственное изображение. Свой фон можно удалить — тогда вернётся фон по умолчанию.</p>
        {error && <ErrorBanner error={error} />}
        {ok && <div className="state-box success" role="status">{ok}</div>}

        <div className="settings-bg-grid" role="list">
          {HOME_BACKGROUNDS.map((item) => {
            const selected = background.source === 'system' && background.id === item.id
            return (
              <button
                key={item.id}
                type="button"
                role="listitem"
                className={`settings-bg-option${selected ? ' is-selected' : ''}`}
                aria-pressed={selected}
                data-testid={`settings-bg-${item.id}`}
                onClick={() => selectSystem(item.id)}
              >
                <img src={item.src} alt="" />
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>

        <div className="stack-sm">
          <label className="btn btn-secondary" style={{ display: 'inline-flex', width: 'fit-content' }}>
            {uploading ? 'Загружаем…' : 'Загрузить свой фон'}
            <input
              ref={fileRef}
              type="file"
              accept={MEDIA_ACCEPT_IMAGES}
              hidden
              disabled={uploading || deleting}
              data-testid="settings-bg-upload"
              onChange={(e) => void onUpload(e.target.files?.[0])}
            />
          </label>
          {background.source === 'custom' && (
            <div className="stack-sm">
              <p className="muted">Сейчас выбран загруженный фон.</p>
              <div
                className="settings-bg-preview"
                style={{ backgroundImage: `url('${background.src}')` }}
                aria-label="Превью своего фона"
              />
              <button
                className="btn btn-danger btn-compact"
                type="button"
                disabled={deleting || uploading}
                data-testid="settings-bg-delete"
                onClick={() => void onDeleteCustom()}
              >
                {deleting ? 'Удаляем…' : 'Удалить свой фон'}
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
