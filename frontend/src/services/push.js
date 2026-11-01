import api from './api'

// Registered once. It keeps listening for calls after the tab or app is closed.
const worker = () => navigator.serviceWorker.register('/sw.js')
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

const toKey = (base64) => {
  const raw = atob(base64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

// Links this browser to whoever is signed in. Asks permission only when called from a click.
export async function enablePush() {
  const { data } = await api.get('/push/key', { quiet: true })
  if (!data.key) return false
  if (Notification.permission === 'default' && (await Notification.requestPermission()) !== 'granted') return false
  if (Notification.permission !== 'granted') return false
  const registration = await worker()
  await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
    || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(data.key) })
  await api.post('/push/subscribe', subscription.toJSON(), { quiet: true })
  return true
}

export async function disablePush() {
  if (!pushSupported()) return
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return
  await api.post('/push/unsubscribe', { endpoint: subscription.endpoint }, { quiet: true }).catch(() => {})
  await subscription.unsubscribe().catch(() => {})
}
