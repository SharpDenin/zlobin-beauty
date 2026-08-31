import { useCallback, useEffect, useState, type ReactNode } from 'react'
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

export function PwaProvider({ children }: { children: ReactNode }) {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [installOpen, setInstallOpen] = useState(false)
  const [dismissed, setDismissed] = useState(installWasDismissed)

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
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

  return (
    <>
      {offline && (
        <div className="pwa-offline-banner" role="status">
          <strong>Нет подключения</strong>
          <span>Проверьте интернет и попробуйте ещё раз.</span>
        </div>
      )}
      {children}
      <Modal
        open={needRefresh}
        onClose={() => setNeedRefresh(false)}
        title="Доступна новая версия"
        footer={(
          <div className="row">
            <button className="btn btn-secondary" type="button" onClick={() => setNeedRefresh(false)}>Позже</button>
            <button className="btn btn-primary" type="button" onClick={() => void updateServiceWorker(true)}>
              Обновить
            </button>
          </div>
        )}
      >
        <p>Обновите приложение, чтобы получить последнюю версию. Текущая сессия сохранится.</p>
      </Modal>
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
