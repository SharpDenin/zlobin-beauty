import { apiRequest } from '@/shared/api/client'

export type PushConfig = { enabled: boolean; public_key: string }

export type DevicePushUiStatus =
  | 'loading'
  | 'unsupported'
  | 'server_disabled'
  | 'denied'
  | 'default'
  | 'subscribed'
  | 'ready'

const VAPID_PUBLIC_STORAGE_KEY = 'zb.push.vapidPublicKey'

export function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

export function browserSupportsWebPush() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
}

export function rememberedVapidPublicKey(): string | null {
  try {
    return localStorage.getItem(VAPID_PUBLIC_STORAGE_KEY)
  } catch {
    return null
  }
}

export function rememberVapidPublicKey(publicKey: string) {
  try {
    localStorage.setItem(VAPID_PUBLIC_STORAGE_KEY, publicKey)
  } catch {
    /* private mode */
  }
}

export function clearRememberedVapidPublicKey() {
  try {
    localStorage.removeItem(VAPID_PUBLIC_STORAGE_KEY)
  } catch {
    /* private mode */
  }
}

/** True when browser subscription was created with a different VAPID public key. */
export function vapidPublicKeyChanged(serverPublicKey: string): boolean {
  const prev = rememberedVapidPublicKey()
  return Boolean(prev && serverPublicKey && prev !== serverPublicKey)
}

export async function fetchPushConfig(token: string | null): Promise<PushConfig> {
  return apiRequest<PushConfig>('/v1/push/config', { token })
}

export async function getLocalPushSubscription() {
  if (!browserSupportsWebPush()) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

/**
 * Resolve UX status without requesting permission.
 * `serverSynced === true` means the local subscription was successfully PUT to the API.
 * A browser-only subscription must not look like “enabled” — otherwise UI lies while
 * communications has zero rows and push is silently skipped.
 */
export async function resolveDevicePushStatus(
  config: PushConfig | null | undefined,
  opts?: { serverSynced?: boolean },
): Promise<DevicePushUiStatus> {
  if (!config) return 'loading'
  if (!browserSupportsWebPush()) return 'unsupported'
  if (!config.enabled || !config.public_key) return 'server_disabled'
  if (Notification.permission === 'denied') return 'denied'
  const sub = await getLocalPushSubscription()
  if (sub) {
    // Existing browser sub may be bound to a rotated VAPID key — treat as needing re-enable.
    if (vapidPublicKeyChanged(config.public_key)) return 'ready'
    if (opts?.serverSynced === true) return 'subscribed'
    // Local sub without confirmed server sync → prompt to enable / retry sync.
    if (opts?.serverSynced === false) return 'ready'
    // Unknown sync state (legacy callers): prefer ready over a false “subscribed”.
    return 'ready'
  }
  if (Notification.permission === 'granted') return 'ready'
  return 'default'
}

async function putSubscription(token: string | null, subscription: PushSubscription) {
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('Не удалось получить ключи подписки')
  }
  await apiRequest('/v1/push/subscription', {
    method: 'PUT',
    token,
    body: {
      endpoint: json.endpoint,
      keys: json.keys,
    },
  })
}

/** Activate a waiting service worker so push handlers (sw-push.js) are current. */
async function activateWaitingServiceWorker(registration: ServiceWorkerRegistration) {
  try {
    await registration.update()
  } catch {
    /* offline / ignored */
  }
  if (!registration.waiting) return
  await new Promise<void>((resolve) => {
    const done = () => resolve()
    navigator.serviceWorker.addEventListener('controllerchange', done, { once: true })
    registration.waiting?.postMessage({ type: 'SKIP_WAITING' })
    window.setTimeout(done, 2500)
  })
}

/**
 * Enable push after an explicit user gesture.
 * Re-subscribes when the server VAPID public key changed (key rotation).
 */
export async function enableDevicePush(token: string | null, publicKey: string) {
  if (!browserSupportsWebPush()) {
    throw new Error('Браузер не поддерживает push-уведомления')
  }
  if (!publicKey) {
    throw new Error('Push на сервере не настроен')
  }
  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Разрешение на уведомления не выдано. Включите их в настройках браузера или системы.')
  }
  let registration = await navigator.serviceWorker.ready
  await activateWaitingServiceWorker(registration)
  registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (subscription && vapidPublicKeyChanged(publicKey)) {
    try {
      await subscription.unsubscribe()
    } catch {
      /* recreate below */
    }
    subscription = null
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
  }
  await putSubscription(token, subscription)
  rememberVapidPublicKey(publicKey)
  return subscription
}

/**
 * If the browser already has a subscription for the current VAPID key, sync it to the backend.
 * When the server key rotated, drop the stale browser subscription so UX shows «ready».
 */
export async function syncDevicePush(token: string | null, publicKey?: string) {
  if (!browserSupportsWebPush() || Notification.permission !== 'granted') return false
  const subscription = await getLocalPushSubscription()
  if (!subscription) return false
  if (publicKey && vapidPublicKeyChanged(publicKey)) {
    try {
      await subscription.unsubscribe()
    } catch {
      /* ignore */
    }
    clearRememberedVapidPublicKey()
    return false
  }
  await putSubscription(token, subscription)
  if (publicKey) rememberVapidPublicKey(publicKey)
  return true
}

export async function disableDevicePush(token: string | null) {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    clearRememberedVapidPublicKey()
    return
  }
  const endpoint = subscription.endpoint
  try {
    await subscription.unsubscribe()
  } catch {
    /* still remove on server */
  }
  clearRememberedVapidPublicKey()
  await apiRequest('/v1/push/subscription', {
    method: 'DELETE',
    token,
    body: { endpoint },
  })
}
