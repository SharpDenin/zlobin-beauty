import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import {
  installWasDismissed,
  isIosBrowser,
  isStandaloneDisplay,
  markInstallDismissed,
  shouldOfferInstall,
} from '@/features/pwa/pwa'
import { Modal } from '@/shared/ui/Modal'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const UPDATE_CHECK_MS = 60 * 60 * 1000
/** Dedupe reloads when several tabs receive controllerchange from the same SKIP_WAITING. */
const SW_RELOAD_GUARD_KEY = 'zb.sw-reload-at'

function reloadForNewServiceWorker() {
  try {
    const now = Date.now()
    const last = Number(sessionStorage.getItem(SW_RELOAD_GUARD_KEY) || 0)
    if (now - last < 8_000) return
    sessionStorage.setItem(SW_RELOAD_GUARD_KEY, String(now))
  } catch {
    /* private mode */
  }
  window.location.reload()
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [installOpen, setInstallOpen] = useState(false)
  const [dismissed, setDismissed] = useState(installWasDismissed)
  const [updateBusy, setUpdateBusy] = useState(false)
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null)
  const updateHooksInstalled = useRef(false)

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      registrationRef.current = registration ?? null
      if (!registration || updateHooksInstalled.current) return
      updateHooksInstalled.current = true
      const check = () => {
        void registration.update().catch(() => undefined)
      }
      // Find new bundles without reinstalling the PWA — hour tick + resume from background.
      window.setInterval(check, UPDATE_CHECK_MS)
      const onWake = () => {
        if (document.visibilityState === 'visible') check()
      }
      document.addEventListener('visibilitychange', onWake)
      window.addEventListener('online', onWake)
    },
  })

  useEffect(() => {
    function sync() {
      setOffline(navigator.onLine === false)
    }
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])

  // When another tab activates a waiting SW (clientsClaim), this tab must reload onto the same
  // bundle — otherwise old JS keeps running under a new controller. zb.auth survives reload.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onControllerChange = () => {
      reloadForNewServiceWorker()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
  }, [])

  useEffect(() => {
    function onPrompt(event: Event) {
      event.preventDefault()
      setInstallEvent(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  useEffect(() => {
    if (!shouldOfferInstall({
      standalone: isStandaloneDisplay(),
      hasPrompt: Boolean(installEvent),
      dismissed,
      iOS: isIosBrowser(),
    })) {
      return
    }
    const timer = window.setTimeout(() => setInstallOpen(true), 4000)
    return () => window.clearTimeout(timer)
  }, [installEvent, dismissed])

  const closeInstall = useCallback(() => {
    setInstallOpen(false)
    setDismissed(true)
    markInstallDismissed()
  }, [])

  async function install() {
    if (!installEvent) {
      closeInstall()
      return
    }
    await installEvent.prompt()
    await installEvent.userChoice.catch(() => undefined)
    setInstallEvent(null)
    closeInstall()
  }

  async function applyUpdate() {
    if (updateBusy) return
    setUpdateBusy(true)
    try {
      // skipWaiting + clientsClaim via workbox message — session in localStorage survives reload.
      await updateServiceWorker(true)
    } finally {
      setUpdateBusy(false)
    }
  }

  return (
    <>
      {offline && (
        <div className="pwa-offline-banner" role="status">
          <strong>Нет подключения</strong>
          <span>Проверьте интернет и попробуйте ещё раз.</span>
        </div>
      )}
      {needRefresh && (
        <div className="pwa-update-banner" role="status" data-testid="pwa-update-banner">
          <div className="pwa-update-banner__copy">
            <strong>Доступна новая версия</strong>
            <span>Обновите без переустановки — сессия сохранится.</span>
          </div>
          <div className="pwa-update-banner__actions">
            <button
              type="button"
              className="btn btn-secondary btn-compact"
              onClick={() => setNeedRefresh(false)}
              disabled={updateBusy}
            >
              Позже
            </button>
            <button
              type="button"
              className="btn btn-primary btn-compact"
              onClick={() => void applyUpdate()}
              disabled={updateBusy}
            >
              {updateBusy ? 'Обновляем…' : 'Обновить'}
            </button>
          </div>
        </div>
      )}
      {children}
      <Modal
        open={installOpen}
        onClose={closeInstall}
        title="Установить Salon-X"
        footer={(
          <div className="row">
            <button className="btn btn-secondary" type="button" onClick={closeInstall}>Не сейчас</button>
            <button className="btn btn-primary" type="button" onClick={() => void install()}>Установить</button>
          </div>
        )}
      >
        <p>Добавьте Salon-X на домашний экран, чтобы быстрее открывать записи, сообщения и магазин.</p>
      </Modal>
    </>
  )
}
