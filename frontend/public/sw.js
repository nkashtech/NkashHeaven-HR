// Runs even with every tab closed: shows incoming calls, and clears them when the call ends.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}
  if (data.type === 'call-ended') {
    event.waitUntil(self.registration.getNotifications({ tag: data.tag }).then((list) => list.forEach((n) => n.close())))
    return
  }
  event.waitUntil(self.registration.showNotification(data.title || 'NkashHeaven-HR', {
    body: data.body, tag: data.tag, icon: '/icon-192.png', badge: '/icon-192.png', requireInteraction: true, renotify: true,
    vibrate: [400, 200, 400, 200, 400, 200, 400], data,
    actions: data.type === 'call' ? [{ action: 'answer', title: 'Answer' }, { action: 'decline', title: 'Decline' }] : [],
  }))
})

self.addEventListener('notificationclick', (event) => {
  const { url, declineUrl } = event.notification.data || {}
  event.notification.close()
  if (event.action === 'decline') {
    event.waitUntil(fetch(declineUrl, { method: 'POST' }).catch(() => {}))
    return
  }
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const client = open[0]
    if (!client) return self.clients.openWindow(url || '/')
    await client.focus()
    return client.navigate ? client.navigate(url || '/') : undefined
  })())
})
