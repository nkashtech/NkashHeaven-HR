import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import toast from 'react-hot-toast'
import api, { SOCKET_URL, session, errorMessage } from '../services/api'
import { useAuth } from './AuthContext'
import { setPeoplePhotos } from '../components/ui'

const LiveContext = createContext(null)
export const useLive = () => useContext(LiveContext)

const offsetFrom = (serverNow) => new Date(serverNow).getTime() - Date.now()

// Attendance state, unread counts and the socket, shared by the top bar, dashboards and chat.
export function LiveProvider({ children }) {
  const { user } = useAuth()
  const [attendance, setAttendance] = useState(null)
  const [offset, setOffset] = useState(0)
  const [unreadChat, setUnreadChat] = useState(0)
  const [unreadBell, setUnreadBell] = useState(0)
  const [busy, setBusy] = useState(false)
  const socketRef = useRef(null)
  const listeners = useRef(new Map())

  const apply = useCallback((data) => {
    setAttendance(data)
    setOffset(offsetFrom(data.serverNow))
  }, [])

  const refreshAttendance = useCallback(async () => {
    const { data } = await api.get('/attendance/status')
    apply(data)
    return data
  }, [apply])

  const refreshCounts = useCallback(async () => {
    const [chat, bell] = await Promise.all([
      user.flags?.chat === false || !user.permissions?.['module.chat'] ? { data: { unread: 0 } } : api.get('/chat/unread').catch(() => ({ data: { unread: 0 } })),
      api.get('/notifications?limit=1'),
    ])
    setUnreadChat(chat.data.unread)
    setUnreadBell(bell.data.unread)
  }, [user])

  useEffect(() => {
    if (user.permissions?.['module.attendance']) refreshAttendance().catch(() => {})
    refreshCounts().catch(() => {})
  }, [refreshAttendance, refreshCounts]) // eslint-disable-line react-hooks/exhaustive-deps

  const receive = useCallback((event, payload) => {
    if (event === 'chat:message' && payload.senderId !== user.id && !window.location.pathname.startsWith('/chat')) setUnreadChat((n) => n + 1)
    if (event === 'notification') {
      setUnreadBell((c) => c + 1)
      if (!(payload.type === 'chat.message' && window.location.pathname.startsWith('/chat'))) toast(payload.title, { icon: '🔔' })
    }
    ;(listeners.current.get(event) || []).forEach((fn) => fn(payload))
  }, [user.id])

  useEffect(() => {
    // A host without live connections, like Vercel, gets a few tries rather than retrying forever.
    const socket = io(SOCKET_URL, { auth: { token: session.token }, transports: ['websocket', 'polling'], reconnectionAttempts: 5 })
    socketRef.current = socket
    ;['chat:message', 'chat:updated', 'chat:typing', 'presence', 'calendar:synced', 'connect', 'notification', 'call:ring'].forEach((e) => socket.on(e, (payload) => receive(e, payload)))
    return () => socket.disconnect()
  }, [receive])

  // Without a live connection the browser asks for news: often in chat, less elsewhere, rarely in a hidden tab.
  useEffect(() => {
    let stop = false
    let timer
    let cursor = {}
    const pause = () => {
      if (document.hidden) return 15000
      return window.location.pathname.startsWith('/chat') ? 3000 : 10000
    }
    const check = async () => {
      if (!socketRef.current?.connected) {
        try {
          const { data } = await api.get('/live', { params: cursor, quiet: true })
          if (stop) return
          cursor = { ...data.cursor, at: data.at }
          data.messages.forEach((m) => receive('chat:message', m))
          data.updated.forEach((m) => receive('chat:updated', m))
          data.notifications.forEach((n) => receive('notification', n))
          data.calls.forEach((c) => receive('call:ring', c))
        } catch { /* The next check catches up. */ }
      }
      if (!stop) timer = setTimeout(check, pause())
    }
    const wake = () => { if (!document.hidden) { clearTimeout(timer); check() } }
    check()
    document.addEventListener('visibilitychange', wake)
    return () => { stop = true; clearTimeout(timer); document.removeEventListener('visibilitychange', wake) }
  }, [receive])

  useEffect(() => {
    const load = () => api.get('/profile/avatars', { quiet: true }).then(({ data }) => setPeoplePhotos(data.people)).catch(() => {})
    load()
    const id = setInterval(load, 300000)
    window.addEventListener('photo:changed', load)
    return () => { clearInterval(id); window.removeEventListener('photo:changed', load) }
  }, [])

  const on = useCallback((event, fn) => {
    const list = listeners.current.get(event) || []
    listeners.current.set(event, [...list, fn])
    return () => listeners.current.set(event, (listeners.current.get(event) || []).filter((f) => f !== fn))
  }, [])

  // The key survives a retry, so a dropped connection can't create a second record (UC-01 2a).
  const punch = useCallback(async () => {
    if (busy) return
    setBusy(true)
    const direction = attendance?.checkedIn ? 'out' : 'in'
    const key = crypto.randomUUID()
    const send = () => api.post(`/attendance/check-${direction}`, null, { headers: { 'Idempotency-Key': key } })
    try {
      let res
      try {
        res = await send()
      } catch (err) {
        if (err.response) throw err
        res = await send()
      }
      apply(res.data)
      window.dispatchEvent(new CustomEvent('attendance:changed'))
    } catch (err) {
      await refreshAttendance().catch(() => {})
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [attendance, busy, apply, refreshAttendance])

  const value = useMemo(() => ({
    attendance, punch, busy, refreshAttendance, unreadChat, setUnreadChat, unreadBell, setUnreadBell, refreshCounts, on,
    socket: socketRef,
    serverNow: () => Date.now() + offset,
  }), [attendance, punch, busy, refreshAttendance, unreadChat, unreadBell, refreshCounts, on, offset])

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>
}
