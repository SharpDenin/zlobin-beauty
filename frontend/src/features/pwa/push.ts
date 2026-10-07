import { apiRequest } from '@/shared/api/client'

export type PushConfig = { enabled: boolean; public_key: string }

export function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

export async function enableDevicePush(token: string | null, publicKey: string) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Браузер не поддерживает push')
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Разрешение на уведомления не выдано')
  }
  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  })
  const json = subscription.toJSON()
  await apiRequest('/v1/push/subscription', {
    method: 'PUT',
    token,
    body: {
      endpoint: json.endpoint,
      keys: json.keys,
    },
  })
  return subscription
}

export async function disableDevicePush(token: string | null) {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return
  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  await apiRequest('/v1/push/subscription', {
    method: 'DELETE',
    token,
    body: { endpoint },
  })
}
