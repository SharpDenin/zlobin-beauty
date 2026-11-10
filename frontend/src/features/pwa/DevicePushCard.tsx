import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { userError } from '@/shared/lib/app-error'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import {
  disableDevicePush,
  enableDevicePush,
  fetchPushConfig,
  resolveDevicePushStatus,
  syncDevicePush,
  type DevicePushUiStatus,
} from '@/features/pwa/push'

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
}

type Props = {
  compact?: boolean
  className?: string
}

export function DevicePushCard({ compact = false, className = '' }: Props) {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const [status, setStatus] = useState<DevicePushUiStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const config = useQuery({
    queryKey: ['push-config'],
    queryFn: () => fetchPushConfig(accessToken),
    enabled: Boolean(accessToken),
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!config.data) {
        if (!cancelled) setStatus('loading')
        return
      }
      let serverSynced = false
      if (config.data.enabled && config.data.public_key && accessToken) {
        try {
          serverSynced = await syncDevicePush(accessToken, config.data.public_key)
        } catch {
          serverSynced = false
        }
      }
      const next = await resolveDevicePushStatus(config.data, { serverSynced })
      if (!cancelled) setStatus(next)
    })()
    return () => {
      cancelled = true
    }
  }, [config.data, accessToken])

  const enable = useMutation({
    mutationFn: async () => {
      if (!config.data?.public_key) throw new Error('Push на сервере не настроен')
      await enableDevicePush(accessToken, config.data.public_key)
    },
    onSuccess: async () => {
      setError(null)
      setOk('Уведомления на устройстве включены')
      setStatus(await resolveDevicePushStatus(config.data, { serverSynced: true }))
      void qc.invalidateQueries({ queryKey: ['push-config'] })
    },
    onError: (e) => {
      setOk(null)
      setError(userError(e, 'Не удалось включить уведомления'))
      void resolveDevicePushStatus(config.data, { serverSynced: false }).then(setStatus)
    },
  })

  const disable = useMutation({
    mutationFn: () => disableDevicePush(accessToken),
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

  const copy = STATUS_COPY[status]
  const canEnable = status === 'default' || status === 'ready' || status === 'denied'
  const canDisable = status === 'subscribed'
  const enableBlocked = status === 'denied' // button still shown so user can retry after fixing OS settings

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
            {enable.isPending ? 'Включаем…' : 'Включить'}
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
