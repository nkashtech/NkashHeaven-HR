import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Mic, MicOff, MonitorUp, Phone, PhoneOff, Video, VideoOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../contexts/AuthContext'
import { useLive } from '../contexts/LiveContext'
import api, { errorMessage } from '../services/api'
import { Avatar } from './ui'

const CallContext = createContext(null)
export const useCall = () => useContext(CallContext)

// Free servers that tell each browser its public address. Audio and video then go directly between browsers.
const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
const RING_FOR_MS = 45000
const QUIET = { quiet: true }

// Connection details are sent as one message, so wait until the browser has found them all.
const gathered = (pc) => new Promise((resolve) => {
  if (pc.iceGatheringState === 'complete') { resolve(); return }
  const timer = setTimeout(resolve, 2500)
  pc.addEventListener('icegatheringstatechange', () => {
    if (pc.iceGatheringState === 'complete') { clearTimeout(timer); resolve() }
  })
})

async function getMedia(video) {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video })
  } catch (err) {
    // No camera, or it's blocked: join with sound only.
    if (video) return navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    throw err
  }
}

function Tile({ name, stream, muted, state }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream || null }, [stream])
  const showVideo = stream?.getVideoTracks().some((t) => t.readyState === 'live')
  return (
    <div className="relative flex min-h-[180px] items-center justify-center overflow-hidden rounded-2xl bg-zinc-900">
      <video ref={ref} autoPlay playsInline muted={muted} className={showVideo ? 'h-full w-full object-cover' : 'hidden'} />
      {!showVideo && <Avatar name={name} size={96} />}
      <div className="absolute bottom-2 left-2 rounded-lg bg-black/60 px-2 py-1 text-xs font-semibold text-white">{name}{state && state !== 'connected' ? ` · ${state === 'failed' ? 'could not connect' : 'connecting…'}` : ''}</div>
    </div>
  )
}

function CallRoom({ user, local, peers, status, muted, cameraOff, sharing, canShare, onMute, onCamera, onShare, onHangUp }) {
  const round = 'flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20'
  const failed = peers.some((p) => p.state === 'failed')
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-zinc-950 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]" role="dialog" aria-label="Call">
      <div className="mb-3 text-center text-[13px] font-semibold text-white/80">{status}</div>
      <div className={`grid min-h-0 flex-1 gap-3 ${peers.length > 1 ? 'md:grid-cols-2' : ''}`}>
        {peers.map((p) => <Tile key={p.id} name={p.name} stream={p.stream} state={p.state} />)}
        {!peers.length && <div className="flex items-center justify-center text-white/60">{status}</div>}
      </div>
      {failed && <p className="mt-2 text-center text-xs text-amber-300">Your networks would not allow a direct connection. Try another network, or use Google Meet from the chat.</p>}
      <div className="absolute bottom-24 right-4 w-28 md:right-6 md:w-56"><Tile name={user.name} stream={local} muted /></div>
      <div className="mt-3 flex items-center justify-center gap-3">
        <button className={round} onClick={onMute} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? <MicOff size={20} /> : <Mic size={20} />}</button>
        {canShare && <button className={round} onClick={onCamera} aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'}>{cameraOff ? <VideoOff size={20} /> : <Video size={20} />}</button>}
        {canShare && <button className={`${round} ${sharing ? '!bg-white/40' : ''}`} onClick={onShare} aria-label={sharing ? 'Stop sharing' : 'Share screen'}><MonitorUp size={20} /></button>}
        <button className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700" onClick={onHangUp} aria-label="Hang up"><PhoneOff size={20} /></button>
      </div>
    </div>
  )
}

function Incoming({ ring, onAccept, onDecline }) {
  useEffect(() => {
    let ctx
    try { ctx = new AudioContext() } catch { return undefined }
    const beep = () => {
      const tone = ctx.createOscillator()
      const gain = ctx.createGain()
      gain.gain.value = 0.08
      tone.frequency.value = 660
      tone.connect(gain).connect(ctx.destination)
      tone.start()
      tone.stop(ctx.currentTime + 0.4)
    }
    beep()
    const id = setInterval(beep, 1800)
    return () => { clearInterval(id); ctx.close() }
  }, [])
  return (
    <div className="fixed inset-x-4 top-4 z-[60] rounded-2xl sm:left-auto sm:w-80 border border-line bg-card p-4 shadow-pop" role="alertdialog" aria-label="Incoming call">
      <div className="flex items-center gap-3">
        <Avatar name={ring.callerName} size={44} />
        <div className="min-w-0">
          <div className="truncate font-bold">{ring.callerName}</div>
          <div className="truncate text-xs text-ink-soft">{ring.video ? 'Video' : 'Voice'} call{ring.conversationName ? ` · #${ring.conversationName}` : ''}</div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button className="btn-danger flex-1" onClick={onDecline}><PhoneOff size={14} />Decline</button>
        <button className="btn-primary flex-1" onClick={onAccept}><Phone size={14} />Answer</button>
      </div>
    </div>
  )
}

export function CallProvider({ children }) {
  const { user } = useAuth()
  const { on } = useLive()
  const [call, setCall] = useState(null)
  const [local, setLocal] = useState(null)
  const [peers, setPeers] = useState([])
  const [ring, setRing] = useState(null)
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [sharing, setSharing] = useState(false)
  const connections = useRef(new Map())
  const streamRef = useRef(null)
  const screenRef = useRef(null)
  const callRef = useRef(null)
  const names = useRef(new Map())
  const ignored = useRef(new Set())
  const ringTimer = useRef(null)
  callRef.current = call

  const updatePeer = useCallback((id, patch) => {
    setPeers((list) => (list.some((p) => p.id === id) ? list.map((p) => (p.id === id ? { ...p, ...patch } : p)) : [...list, { id, name: names.current.get(id) || 'Connecting…', state: 'connecting', ...patch }]))
  }, [])

  const dropPeer = useCallback((id) => {
    connections.current.get(id)?.close()
    connections.current.delete(id)
    setPeers((list) => list.filter((p) => p.id !== id))
  }, [])

  const cleanUp = useCallback(() => {
    connections.current.forEach((pc) => pc.close())
    connections.current.clear()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    screenRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    screenRef.current = null
    setLocal(null)
    setPeers([])
    setCall(null)
    setMuted(false)
    setCameraOff(false)
    setSharing(false)
  }, [])

  const connection = useCallback((peerId) => {
    const existing = connections.current.get(peerId)
    if (existing) return existing
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    connections.current.set(peerId, pc)
    streamRef.current.getTracks().forEach((t) => pc.addTrack(t, streamRef.current))
    pc.ontrack = (e) => updatePeer(peerId, { stream: e.streams[0] })
    pc.onconnectionstatechange = () => updatePeer(peerId, { state: pc.connectionState })
    updatePeer(peerId, {})
    return pc
  }, [updatePeer])

  const send = (id, toId, kind, description) => api.post(`/chat/calls/${id}/signal`, { toId, kind, payload: JSON.stringify(description) }, QUIET)

  const handle = useCallback(async (id, signal) => {
    const description = JSON.parse(signal.payload)
    if (signal.kind === 'offer') {
      const pc = connection(signal.fromId)
      await pc.setRemoteDescription(description)
      await pc.setLocalDescription(await pc.createAnswer())
      await gathered(pc)
      await send(id, signal.fromId, 'answer', pc.localDescription)
    } else {
      await connections.current.get(signal.fromId)?.setRemoteDescription(description)
    }
  }, [connection])

  // Whoever arrives calls each person already there, so two browsers never both start the same connection.
  const greet = useCallback(async (id, peerId) => {
    const pc = connection(peerId)
    await pc.setLocalDescription(await pc.createOffer())
    await gathered(pc)
    await send(id, peerId, 'offer', pc.localDescription)
  }, [connection])

  const hangUp = useCallback(async () => {
    const current = callRef.current
    cleanUp()
    if (current) await api.post(`/chat/calls/${current.id}/leave`, null, QUIET).catch(() => {})
  }, [cleanUp])

  const enter = useCallback(async (next, peerList = []) => {
    setCall(next)
    peerList.forEach((p) => names.current.set(p.id, p.name))
    await Promise.all(peerList.map((p) => greet(next.id, p.id).catch(() => updatePeer(p.id, { state: 'failed' }))))
  }, [greet, updatePeer])

  const prepare = async (video) => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot make calls')
    const stream = await getMedia(video)
    streamRef.current = stream
    setLocal(stream)
  }

  const failed = (err) => {
    cleanUp()
    toast.error(err.name === 'NotAllowedError' ? 'Allow your microphone in the browser to make calls' : errorMessage(err))
  }

  const join = useCallback(async (id, video = true) => {
    if (callRef.current) return
    setRing(null)
    try {
      await prepare(video)
      const { data } = await api.post(`/chat/calls/${id}/join`)
      await enter(data.call, data.peers)
    } catch (err) { failed(err) }
  }, [enter]) // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback(async (conversationId, video) => {
    if (callRef.current) return
    try {
      await prepare(video)
      const { data } = await api.post(`/chat/conversations/${conversationId}/calls`, { video })
      if (data.joined) await enter(data.call)
      else {
        const joined = await api.post(`/chat/calls/${data.call.id}/join`)
        await enter(joined.data.call, joined.data.peers)
      }
    } catch (err) { failed(err) }
  }, [enter]) // eslint-disable-line react-hooks/exhaustive-deps

  // While in a call: collect connection details from others, and notice who has left.
  useEffect(() => {
    if (!call) return undefined
    let stop = false
    let after = 0
    let timer
    const startedAt = Date.now()
    const tick = async () => {
      let settled = false
      try {
        const { data } = await api.get(`/chat/calls/${call.id}`, { params: { after }, ...QUIET })
        if (stop) return
        if (data.call.endedAt) { cleanUp(); toast('Call ended'); return }
        for (const signal of data.signals) {
          after = signal.id
          await handle(call.id, signal).catch(() => updatePeer(signal.fromId, { state: 'failed' }))
        }
        data.members.forEach((m) => {
          names.current.set(m.id, m.name)
          if (m.id !== user.id) setPeers((list) => list.map((p) => (p.id === m.id ? { ...p, name: m.name } : p)))
        })
        const present = new Set(data.members.map((m) => m.id))
        connections.current.forEach((pc, id) => { if (!present.has(id) && pc.connectionState !== 'new') dropPeer(id) })
        if (data.members.length < 2 && !connections.current.size && Date.now() - startedAt > RING_FOR_MS) { hangUp(); toast('No answer'); return }
        settled = data.members.length > 1 && [...connections.current.values()].every((pc) => pc.connectionState === 'connected')
      } catch { /* A missed check is picked up by the next one. */ }
      if (!stop) timer = setTimeout(tick, settled ? 4000 : 1000)
    }
    tick()
    return () => { stop = true; clearTimeout(timer) }
  }, [call?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => on('call:ring', (incoming) => {
    if (callRef.current || ignored.current.has(incoming.id)) return
    setRing(incoming)
    clearTimeout(ringTimer.current)
    // The caller gave up if nothing has said otherwise for a while.
    ringTimer.current = setTimeout(() => setRing(null), 25000)
  }), [on])

  const decline = async () => {
    ignored.current.add(ring.id)
    const { id } = ring
    setRing(null)
    await api.post(`/chat/calls/${id}/decline`).catch(() => {})
  }

  const toggleMute = () => {
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = muted })
    setMuted(!muted)
  }
  const toggleCamera = () => {
    streamRef.current?.getVideoTracks().forEach((t) => { t.enabled = cameraOff })
    setCameraOff(!cameraOff)
  }
  const replaceVideo = (track) => connections.current.forEach((pc) => pc.getSenders().find((s) => s.track?.kind === 'video' || s.track === null)?.replaceTrack(track))
  const stopSharing = () => {
    screenRef.current?.getTracks().forEach((t) => t.stop())
    screenRef.current = null
    replaceVideo(streamRef.current?.getVideoTracks()[0] || null)
    setLocal(streamRef.current)
    setSharing(false)
  }
  const toggleShare = async () => {
    if (sharing) { stopSharing(); return }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true })
      screenRef.current = screen
      replaceVideo(screen.getVideoTracks()[0])
      screen.getVideoTracks()[0].onended = stopSharing
      setLocal(screen)
      setSharing(true)
    } catch { /* They closed the picker. */ }
  }

  const value = useMemo(() => ({ start, join, inCall: Boolean(call) }), [start, join, call])
  const live = peers.some((p) => p.state === 'connected')
  return (
    <CallContext.Provider value={value}>
      {children}
      {ring && !call && <Incoming ring={ring} onAccept={() => join(ring.id, ring.video)} onDecline={decline} />}
      {call && (
        <CallRoom
          user={user} local={local} peers={peers} status={live ? 'In call' : peers.length ? 'Connecting…' : 'Ringing…'} muted={muted} cameraOff={cameraOff} sharing={sharing}
          canShare={Boolean(streamRef.current?.getVideoTracks().length)} onMute={toggleMute} onCamera={toggleCamera} onShare={toggleShare} onHangUp={hangUp}
        />
      )}
    </CallContext.Provider>
  )
}
