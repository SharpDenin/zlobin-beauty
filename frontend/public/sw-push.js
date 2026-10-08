/* Push display for the generated service worker. Delivery requires VAPID keys on the communications service. */
self.addEventListener('push', (event) => {
  let payload = { title: 'Salon-X', body: '', url: '/notifications' }
  try {
    if (event.data) payload = { ...payload, ...event.data.json() }
  } catch {
    payload.body = event.data ? event.data.text() : ''
  }
  event.waitUntil(self.registration.showNotification(payload.title || 'Salon-X', {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: payload.url || '/notifications' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/notifications'
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of all) {
      if ('focus' in client) {
        await client.focus()
        if ('navigate' in client) {
          try { await client.navigate(url) } catch { /* older browsers */ }
        }
        return
      }
    }
    await self.clients.openWindow(url)
  })())
})
