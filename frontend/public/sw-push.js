/* Push display for the generated service worker. Delivery requires VAPID keys on the communications service. */
self.addEventListener('push', (event) => {
  let payload = { title: 'Salon-X', body: '', url: '/notifications' }
  try {
    if (event.data) payload = { ...payload, ...event.data.json() }
  } catch {
    payload.body = event.data ? event.data.text() : ''
  }
  const title = (payload.title && String(payload.title).trim()) || 'Salon-X'
  const body = payload.body != null ? String(payload.body) : ''
  const url = (payload.url && String(payload.url).trim()) || '/notifications'
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const raw = (event.notification.data && event.notification.data.url) || '/notifications'
  event.waitUntil((async () => {
    const targetUrl = new URL(raw, self.location.origin).href
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of all) {
      if (!client.url.startsWith(self.location.origin)) continue
      if ('focus' in client) {
        await client.focus()
        if ('navigate' in client) {
          try { await client.navigate(targetUrl) } catch { /* older browsers */ }
        }
        return
      }
    }
    await self.clients.openWindow(targetUrl)
  })())
})
