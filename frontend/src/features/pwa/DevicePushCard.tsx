import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { userError } from '@/shared/lib/app-error'
import { usePreference } from '@/shared/lib/preferences'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import {
  disableDevicePush,
  enableDevicePush,
  fetchPushConfig,
  resolveDevicePushStatus,
  syncDevicePush,
  type DevicePushUiStatus,
} from '@/features/pwa/push'

export const PUSH_ONBOARDING_PREF_KEY = 'ui.push_onboarding'

export type PushOnboardingPref = {
  declined: boolean
}

const DEFAULT_PUSH_ONBOARDING: PushOnboardingPref = { declined: false }

/** Hard ceiling for config + SW + optional sync so UI never sticks on «Проверяем…». */
const PUSH_CHECK_TIMEOUT_MS = 12_000

const STATUS_COPY: Record<DevicePushUiStatus, { title: string; hint: string }> = {
  loading: { title: 'Проверяем…', hint: '' },
  unsupported: {
    title: 'Браузер не поддерживает Web Push',
    hint: 'На iPhone уведомления работают после установки Salon-X на домашний экран (Share → На экран «Домой») в поддерживаемой версии iOS. На Android предпочтительна установленная PWA или Chrome.',
  },
  server_disabled: {
    title: 'Push на сервере пока выключен',
    hint: 'Администратору нужно задать VAPID-ключи. Лента уведомлений в приложении работает как раньше.',
  },
  denied: {
    title: 'Разрешение отклонено',
    hint: 'Откройте настройки сайта или системы и разрешите уведомления для Salon-X, затем нажмите «Включить» снова.',
  },
  default: {
    title: 'Уведомления на устройстве выключены',
    hint: 'Мы запросим разрешение системы только после вашего нажатия.',
  },
  ready: {
    title: 'Нужно подтвердить подписку на сервере',
    hint: 'Разрешение браузера есть, но сервер ещё не получил подписку этого устройства. Нажмите «Включить».',
  },
  subscribed: {
    title: 'Уведомления на этом устройстве включены',
    hint: 'Системные push приходят при событиях Salon-X. Можно отключить в любой момент.',
  },
  error: {
    title: 'Не удалось проверить Push',
    hint: 'Проверьте соединение и войдите снова при необходимости, затем нажмите «Включить» или обновите страницу.',
  },
}

type Props = {
  compact?: boolean
  className?: string
  /** Home onboarding: hide after enable or explicit decline; show «Не включать». */
  homePrompt?: boolean
}

export function DevicePushCard({ compact = false, className = '', homePrompt = false }: Props) {
  const { accessToken, user } = useAuth()
  const userId = user?.id ?? null
  const qc = useQueryClient()
  const [status, setStatus] = useState<DevicePushUiStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [onboarding, setOnboarding] = usePreference<PushOnboardingPref>(
    PUSH_ONBOARDING_PREF_KEY,
    DEFAULT_PUSH_ONBOARDING,
  )
  const checkGenRef = useRef(0)

  const config = useQuery({
    queryKey: ['push-config', userId],
    queryFn: ({ signal }) => fetchPushConfig(accessToken, signal),
    enabled: Boolean(accessToken && userId),
    retry: false,
  })

  useEffect(() => {
    // Account switch / logout: drop prior user status immediately.
    if (!userId || !accessToken) {
      setStatus('error')
      setError(null)
      setOk(null)
      return
    }
    setStatus('loading')
    setError(null)
    setOk(null)

    const gen = ++checkGenRef.current
    let cancelled = false
    const wallClock = window.setTimeout(() => {
      if (cancelled || checkGenRef.current !== gen) return
      setStatus('error')
      setError('Проверка Push заняла слишком много времени. Попробуйте ещё раз.')
    }, PUSH_CHECK_TIMEOUT_MS)

    ;(async () => {
      if (config.isError) {
        if (!cancelled && checkGenRef.current === gen) {
          setStatus('error')
          setError(userError(config.error, 'Не удалось загрузить настройки Push'))
        }
        return
      }
      if (config.isPending || (config.isFetching && !config.data)) {
        if (!cancelled && checkGenRef.current === gen) setStatus('loading')
        return
      }
      if (!config.data) {
        if (!cancelled && checkGenRef.current === gen) {
          setStatus('error')
          setError('Не удалось загрузить настройки Push')
        }
        return
      }
      let serverSynced = false
      try {
        if (config.data.enabled && config.data.public_key) {
          try {
            serverSynced = await syncDevicePush(null, config.data.public_key)
          } catch {
            serverSynced = false
          }
        }
        if (cancelled || checkGenRef.current !== gen) return
        const next = await resolveDevicePushStatus(config.data, { serverSynced })
        if (cancelled || checkGenRef.current !== gen) return
        setStatus(next === 'loading' ? 'default' : next)
        setError(null)
      } catch {
        if (!cancelled && checkGenRef.current === gen) setStatus('error')
      }
    })()

    return () => {
      cancelled = true
      window.clearTimeout(wallClock)
    }
    // Depend on userId (account) + config status — not accessToken rotation (avoids PUT storms).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- accessToken only gates presence via userId/query enabled
  }, [userId, config.data, config.isPending, config.isFetching, config.isError, config.error])

  const enable = useMutation({
    mutationFn: async () => {
      if (!config.data?.public_key) throw new Error('Push на сервере не настроен')
      // Pass null so put path always reads a fresh token from the auth bridge after permission UI.
      await enableDevicePush(null, config.data.public_key)
    },
    onSuccess: async () => {
      setError(null)
      setOk('Уведомления на устройстве включены')
      setOnboarding({ declined: false })
      setStatus(await resolveDevicePushStatus(config.data, { serverSynced: true }))
      void qc.invalidateQueries({ queryKey: ['push-config', userId] })
    },
    onError: (e) => {
      setOk(null)
      setError(userError(e, 'Не удалось включить уведомления'))
      void resolveDevicePushStatus(config.data ?? { enabled: false, public_key: '' }, { serverSynced: false })
        .then((next) => setStatus(next === 'loading' || next === 'error' ? 'ready' : next))
        .catch(() => setStatus('ready'))
    },
  })

  const disable = useMutation({
    mutationFn: () => disableDevicePush(null),
    onSuccess: async () => {
      setError(null)
      setOk('Уведомления на устройстве отключены')
      setStatus(await resolveDevicePushStatus(config.data, { serverSynced: false }))
    },
    onError: (e) => {
      setOk(null)
      setError(userError(e, 'Не удалось отключить уведомления'))
    },
  })

  function declineHomePrompt() {
    setOnboarding({ declined: true })
    setError(null)
    setOk(null)
  }

  const copy = STATUS_COPY[status]
  const canEnable = status === 'default' || status === 'ready' || status === 'denied' || status === 'error'
  const canDisable = status === 'subscribed'
  const enableBlocked = status === 'denied'

  if (homePrompt && (status === 'subscribed' || onboarding.declined)) {
    return null
  }
  if (homePrompt && (status === 'unsupported' || status === 'server_disabled')) {
    return null
  }

  return (
    <section className={`card stack ${className}`.trim()} data-testid="device-push-card">
      <h2>{compact ? 'Push на устройстве' : 'Уведомления на устройстве'}</h2>
      <p className="muted" data-testid="device-push-status">{copy.title}</p>
      {copy.hint && <p className="muted hint">{copy.hint}</p>}
      {error && <ErrorBanner error={error} />}
      {ok && <div className="state-box success" role="status">{ok}</div>}
      <div className="row gap wrap">
        {canEnable && (
          <button
            type="button"
            className="btn btn-primary"
            data-testid="device-push-enable"
            disabled={enable.isPending}
            onClick={() => enable.mutate()}
            aria-describedby={enableBlocked ? 'device-push-status' : undefined}
          >
            {enable.isPending ? 'Включаем…' : homePrompt ? 'Включить уведомления' : 'Включить'}
          </button>
        )}
        {homePrompt && canEnable && status !== 'error' && (
          <button
            type="button"
            className="btn btn-secondary"
            data-testid="device-push-decline"
            disabled={enable.isPending}
            onClick={declineHomePrompt}
          >
            Не включать
          </button>
        )}
        {canDisable && (
          <button
            type="button"
            className="btn btn-secondary"
            data-testid="device-push-disable"
            disabled={disable.isPending}
            onClick={() => disable.mutate()}
          >
            {disable.isPending ? 'Отключаем…' : 'Отключить'}
          </button>
        )}
      </div>
    </section>
  )
}
