import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import toast from 'react-hot-toast'
import api, { SOCKET_URL, session, errorMessage } from '../services/api'
import { useAuth } from './AuthContext'

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

  useEffect(() => {
    const socket = io(SOCKET_URL, { auth: { token: session.token }, transports: ['websocket', 'polling'] })
    socketRef.current = socket
    const fan = (event) => (payload) => (listeners.current.get(event) || []).forEach((fn) => fn(payload))
    ;['chat:message', 'chat:updated', 'chat:typing', 'presence', 'calendar:synced', 'connect'].forEach((e) => socket.on(e, fan(e)))
    socket.on('chat:message', (m) => {
      if (m.senderId !== user.id && !window.location.pathname.startsWith('/chat')) setUnreadChat((n) => n + 1)
    })
    socket.on('notification', (n) => {
      setUnreadBell((c) => c + 1)
      toast(n.title, { icon: '🔔' })
    })
    return () => socket.disconnect()
  }, [user.id])

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
