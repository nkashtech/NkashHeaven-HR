import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Download, ExternalLink, FileText, Forward, Hash, Paperclip, Pencil, Phone, Pin, PinOff, Plus, Quote, Search, Send, Trash2, Video, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../contexts/AuthContext'
import { useLive } from '../contexts/LiveContext'
import { AuthedImage, Avatar, Empty, Field, Modal, PageHeader, Pill, ReasonModal, Spinner, fileUrl } from '../components/ui'
import { useCall } from '../components/Call'
import { useFetch } from '../components/hooks'
import { companyToday, dayOf, fmtDay, fmtTime } from '../utils/format'
import api, { download, errorMessage, uploadFile } from '../services/api'

const presenceTone = { in: 'ok', leave: 'info', offline: 'neutral' }
const presenceText = (p) => (p ? (p.dnd ? 'Do not disturb' : p.label) : '')
const MAX_MB = Number(import.meta.env.VITE_MAX_UPLOAD_MB) || 20
const fileSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const MEETINGS = { google: ['Google Meet', 'https://meet.google.com/new'] }

function Attachment({ file }) {
  const failed = (e) => toast.error(errorMessage(e))
  const open = async () => {
    try { window.open(await fileUrl(file.id), '_blank', 'noreferrer') } catch (e) { failed(e) }
  }
  const save = () => download(`/files/${file.id}`, file.name).catch(failed)
  if (file.mime?.startsWith('image/')) {
    return <button type="button" onClick={open} className="mt-1 block overflow-hidden rounded-lg" aria-label={`Open ${file.name}`}><AuthedImage fileId={file.id} alt={file.name} className="max-h-64 max-w-full rounded-lg object-contain" /></button>
  }
  return (
    <div className="mt-1 flex w-72 max-w-full items-center gap-2.5 rounded-lg border border-line bg-card p-2">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-ink"><FileText size={17} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{file.name}</span>
        <span className="block text-[11px] text-ink-muted">{fileSize(file.size)}</span>
      </span>
      {file.mime === 'application/pdf' && <button type="button" className="rounded p-1.5 text-ink-muted hover:bg-subtle" onClick={open} aria-label={`Open ${file.name}`}><ExternalLink size={14} /></button>}
      <button type="button" className="rounded p-1.5 text-ink-muted hover:bg-subtle" onClick={save} aria-label={`Download ${file.name}`}><Download size={14} /></button>
    </div>
  )
}

const quoteText = (q) => (q.deleted ? 'Message deleted' : q.body || q.fileName || q.attachment?.name || 'Sent a file')

function ForwardModal({ message, list, onClose }) {
  const [picked, setPicked] = useState([])
  const [q, setQ] = useState('')
  const options = [...list.channels, ...list.direct].filter((c) => c.type !== 'BOT' && c.name.toLowerCase().includes(q.toLowerCase()))
  const send = async () => {
    try {
      await api.post(`/chat/messages/${message.id}/forward`, { conversationIds: picked })
      toast.success('Message forwarded')
      onClose()
    } catch (err) { toast.error(errorMessage(err)) }
  }
  return (
    <Modal title="Forward message" onClose={onClose}>
      <div className="space-y-3">
        <div className="rounded-lg bg-subtle px-3 py-2 text-[13px]"><div className="text-[11px] font-semibold text-ink-muted">{message.senderName}</div><div className="line-clamp-2">{quoteText(message)}</div></div>
        <input autoFocus className="input" placeholder="Search people and channels" aria-label="Search people and channels" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-56 overflow-y-auto">
          {options.map((c) => (
            <label key={c.id} className="flex items-center gap-2 rounded-lg px-1 py-1.5 text-[13px] hover:bg-subtle">
              <input type="checkbox" className="accent-brand" checked={picked.includes(c.id)} onChange={() => setPicked(picked.includes(c.id) ? picked.filter((x) => x !== c.id) : [...picked, c.id])} />
              {c.type === 'CHANNEL' ? <Hash size={14} className="text-ink-muted" /> : <Avatar name={c.name} size={24} />}{c.name}
            </label>
          ))}
          {!options.length && <Empty>Nothing found.</Empty>}
        </div>
        <button className="btn-primary w-full" disabled={!picked.length} onClick={send}>Forward{picked.length > 1 ? ` to ${picked.length}` : ''}</button>
      </div>
    </Modal>
  )
}

// Until Google is connected to the system, a meeting's real link is only visible on their site.
function ShareMeeting({ provider, conversationId, onClose }) {
  const [label, startUrl] = MEETINGS[provider]
  const [url, setUrl] = useState('')
  const share = async (e) => {
    e.preventDefault()
    try {
      await api.post(`/chat/conversations/${conversationId}/meeting-link`, { url })
      onClose()
    } catch (err) { toast.error(errorMessage(err)) }
  }
  return (
    <Modal title={`Share a ${label} meeting`} onClose={onClose}>
      <form onSubmit={share} className="space-y-3">
        <p className="text-[13px] text-ink-soft">{label} isn't connected to this system yet, so its link can't be picked up by itself. Copy it from the new tab and paste it here so everyone joins the same meeting.</p>
        <a className="link text-[13px]" href={startUrl} target="_blank" rel="noreferrer">Open {label} again</a>
        <Field label="Meeting link"><input required autoFocus className="input" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
        <button className="btn-primary w-full">Share in this chat</button>
      </form>
    </Modal>
  )
}

function Row({ c, active, onClick }) {
  const isChannel = c.type === 'CHANNEL'
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left ${active ? 'bg-card shadow-soft' : 'hover:bg-card/60'}`}>
      {isChannel ? <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-subtle text-ink-soft"><Hash size={14} /></span> : <Avatar name={c.name} size={32} presence={c.presence} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{c.name}</span>
        {!isChannel && <span className="block truncate text-[11px] text-ink-muted">{c.type === 'BOT' ? 'Notifications' : presenceText(c.presence) || c.lastMessage}</span>}
      </span>
      {c.unread > 0 && <span className="min-w-[20px] rounded-full bg-brand px-1.5 py-0.5 text-center text-[10px] font-bold text-white">{c.unread}</span>}
    </button>
  )
}

function NewChat({ onClose, onOpen }) {
  const { data } = useFetch('/chat/people')
  const [group, setGroup] = useState(false)
  const [picked, setPicked] = useState([])
  const [name, setName] = useState('')
  const [q, setQ] = useState('')
  const start = async (id) => {
    const { data: r } = await api.post('/chat/direct', { userId: id })
    onOpen(r.conversationId)
  }
  const create = async () => {
    try {
      const { data: r } = await api.post('/chat/groups', { name, userIds: picked })
      onOpen(r.conversationId)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const people = (data?.people || []).filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <Modal title="New message" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <button className={group ? 'btn-outline' : 'btn-primary'} onClick={() => setGroup(false)}>Direct</button>
          <button className={group ? 'btn-primary' : 'btn-outline'} onClick={() => setGroup(true)}>Group</button>
        </div>
        {group && <Field label="Group name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>}
        <input className="input" placeholder="Search people" aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-64 overflow-y-auto">
          {people.map((p) => (group ? (
            <label key={p.id} className="flex items-center gap-2 px-1 py-1 text-[13px]">
              <input type="checkbox" className="accent-brand" checked={picked.includes(p.id)} onChange={() => setPicked(picked.includes(p.id) ? picked.filter((x) => x !== p.id) : [...picked, p.id])} />{p.name}
            </label>
          ) : (
            <button key={p.id} className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left hover:bg-subtle" onClick={() => start(p.id)}>
              <Avatar name={p.name} size={28} presence={p.presence} />
              <span className="text-[13px]">{p.name}<span className="ml-1 text-xs text-ink-muted">{p.jobTitle}</span></span>
            </button>
          )))}
        </div>
        {group && <button className="btn-primary w-full" disabled={!name.trim() || !picked.length} onClick={create}>Create group ({picked.length + 1} people)</button>}
      </div>
    </Modal>
  )
}

function SearchPanel({ onClose, onOpen, conversationId }) {
  const [q, setQ] = useState('')
  const [only, setOnly] = useState(false)
  const [from, setFrom] = useState('')
  const url = q.trim().length >= 2 ? `/chat/search?q=${encodeURIComponent(q)}${only ? `&conversationId=${conversationId}` : ''}${from ? `&from=${from}` : ''}` : null
  const { data } = useFetch(url)
  return (
    <Modal title="Search messages and people" onClose={onClose}>
      <input autoFocus className="input" placeholder="Search" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px]">
        <label className="flex items-center gap-2"><input type="checkbox" className="accent-brand" checked={only} onChange={(e) => setOnly(e.target.checked)} />This conversation only</label>
        <label className="flex items-center gap-2">From <input type="date" className="input !w-auto !py-1" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      </div>
      <div className="mt-3 max-h-72 overflow-y-auto">
        {data?.people.map((p) => <button key={p.id} className="block w-full rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-subtle" onClick={async () => { const { data: r } = await api.post('/chat/direct', { userId: p.id }); onOpen(r.conversationId) }}><b>{p.name}</b> <span className="text-ink-muted">{p.jobTitle}</span></button>)}
        {data?.messages.map((m) => (
          <button key={m.id} className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-subtle" onClick={() => onOpen(m.conversationId)}>
            <div className="text-xs text-ink-muted">{m.senderName} · {fmtDay(dayOf(m.createdAt), 'd MMM')} {fmtTime(m.createdAt)}</div>
            <div className="truncate text-[13px]">{m.body}</div>
          </button>
        ))}
        {data && !data.people.length && !data.messages.length && <Empty>No results.</Empty>}
      </div>
    </Modal>
  )
}

function Message({ m, mine, onEdit, onDelete, onPin, onQuote, onForward, onJoin, onJump }) {
  const editable = mine && !m.deleted && Date.now() - new Date(m.createdAt) < 15 * 60000
  const callId = m.link?.match(/[?&]call=(\d+)/)?.[1]
  const action = 'rounded p-1 text-ink-muted hover:bg-subtle'
  return (
    <div id={m.id ? `message-${m.id}` : undefined} className="group flex gap-2.5">
      <Avatar name={m.senderName} size={32} />
      <div className="min-w-0 max-w-[75%]">
        <div className="text-[11px] text-ink-muted">
          <b className="text-ink">{m.senderName}</b>{m.formerEmployee && ' (former employee)'} · {fmtTime(m.createdAt)}{m.edited && ' · edited'}{m.pinned && ' · pinned'}{m.sending && ' · Sending…'}
        </div>
        <div className={`mt-0.5 inline-block max-w-full rounded-xl px-3 py-2 text-[13px] ${m.deleted ? 'italic text-ink-muted' : 'bg-subtle'}`}>
          {m.forwardedFrom && !m.deleted && <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-ink-muted"><Forward size={11} />Forwarded from {m.forwardedFrom}</div>}
          {m.reply && (
            <button type="button" onClick={() => onJump(m.reply.id)} className="mb-1 block w-full rounded-lg border-l-2 border-brand bg-card/70 px-2 py-1 text-left">
              <span className="block text-[11px] font-semibold text-ink-soft">{m.reply.senderName}</span>
              <span className="line-clamp-2 block text-xs text-ink-muted">{quoteText(m.reply)}</span>
            </button>
          )}
          {m.deleted ? 'Message deleted' : m.body && <span className="whitespace-pre-wrap break-words">{m.body}</span>}
          {m.attachment && <Attachment file={m.attachment} />}
          {m.link && !m.deleted && (callId
            ? <button type="button" className="link mt-1 block" onClick={() => onJoin(Number(callId))}>Join call</button>
            : m.link.startsWith('http')
              ? <a className="link mt-1 block" href={m.link} target="_blank" rel="noreferrer">Join meeting</a>
              : <Link className="link mt-1 block" to={m.link}>Open</Link>)}
        </div>
      </div>
      {!m.deleted && !m.sending && m.id && (
        <div className="invisible flex items-center gap-1 self-center group-hover:visible">
          {m.senderId !== null && <button className={action} onClick={() => onQuote(m)} aria-label="Quote message" title="Quote"><Quote size={13} /></button>}
          {m.senderId !== null && <button className={action} onClick={() => onForward(m)} aria-label="Forward message" title="Forward"><Forward size={13} /></button>}
          {m.senderId !== null && <button className={`${action} ${m.pinned ? '!text-brand-ink' : ''}`} onClick={() => onPin(m)} aria-label={m.pinned ? 'Unpin message' : 'Pin message'} title={m.pinned ? 'Unpin' : 'Pin'}>{m.pinned ? <PinOff size={13} /> : <Pin size={13} />}</button>}
          {editable && <button className={action} onClick={() => onEdit(m)} aria-label="Edit message" title="Edit"><Pencil size={13} /></button>}
          {editable && <button className={action} onClick={() => onDelete(m)} aria-label="Delete message" title="Delete"><Trash2 size={13} /></button>}
        </div>
      )}
    </div>
  )
}

export default function Chat() {
  const { user } = useAuth()
  const { on, socket, setUnreadChat } = useLive()
  const { start: startCall, join: joinCall } = useCall()
  const [params, setParams] = useSearchParams()
  const { data: list, reload: reloadList } = useFetch('/chat/conversations')
  const [activeId, setActiveId] = useState(params.get('c') ? Number(params.get('c')) : null)
  const joinOnOpen = useRef(params.get('join') === '1')
  const answerOnOpen = useRef(params.get('answer') === '1' ? Number(params.get('call')) : null)
  const [info, setInfo] = useState(null)
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [quoting, setQuoting] = useState(null)
  const [forwarding, setForwarding] = useState(null)
  const [callMenu, setCallMenu] = useState(false)
  const [meeting, setMeeting] = useState(null)
  const [newChat, setNewChat] = useState(false)
  const [searching, setSearching] = useState(false)
  const [editing, setEditing] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [typing, setTyping] = useState(false)
  const queue = useRef([])
  const bottom = useRef(null)
  const activeRef = useRef(activeId)
  activeRef.current = activeId

  useEffect(() => {
    if (activeId === null && list) {
      const first = list.channels[0] || list.direct[0]
      if (first) setActiveId(first.id)
    }
  }, [list, activeId])

  useEffect(() => { if (list) setUnreadChat(list.unread) }, [list, setUnreadChat])

  const load = useCallback(async (id) => {
    const [conv, msgs] = await Promise.all([api.get(`/chat/conversations/${id}`), api.get(`/chat/conversations/${id}/messages`)])
    setInfo(conv.data)
    setMessages(msgs.data.messages)
    await api.post(`/chat/conversations/${id}/read`)
    reloadList()
  }, [reloadList])

  useEffect(() => {
    if (!activeId) return
    setInfo(null)
    setMessages([])
    setQuoting(null)
    setParams({ c: activeId }, { replace: true })
    load(activeId).catch((e) => toast.error(errorMessage(e)))
  }, [activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { bottom.current?.scrollIntoView() }, [messages])

  // A scheduled in-app meeting's link: whoever arrives first starts the call and the rest join it.
  useEffect(() => {
    if (joinOnOpen.current && activeId) {
      joinOnOpen.current = false
      startCall(activeId, true)
    }
    // Answer on a call notification.
    if (answerOnOpen.current) {
      const id = answerOnOpen.current
      answerOnOpen.current = null
      joinCall(id)
    }
  }, [activeId, startCall, joinCall])

  const refreshInfo = useCallback((id) => api.get(`/chat/conversations/${id}`).then((r) => { if (id === activeRef.current) setInfo(r.data) }).catch(() => {}), [])

  // Anything typed while offline waits here and goes out on reconnect (UC-11 4a).
  const flush = useCallback(async () => {
    const pending = [...queue.current]
    for (const item of pending) {
      try {
        const { data } = await api.post(`/chat/conversations/${item.conversationId}/messages`, item.payload)
        queue.current = queue.current.filter((q) => q !== item)
        setMessages((ms) => ms.map((m) => (m.clientId === item.payload.clientId ? data.message : m)))
      } catch (err) {
        if (err.response) {
          queue.current = queue.current.filter((q) => q !== item)
          setMessages((ms) => ms.filter((m) => m.clientId !== item.payload.clientId))
          toast.error(errorMessage(err))
        } else return
      }
    }
  }, [])

  useEffect(() => {
    const offs = [
      on('chat:message', (m) => {
        // Notices about your own call or meeting are for the other person.
        if (m.receiverOnly && m.senderId === user.id) return
        if (m.conversationId === activeRef.current) {
          setMessages((ms) => (ms.some((x) => x.id === m.id || (m.clientId && x.clientId === m.clientId)) ? ms.map((x) => (x.clientId && x.clientId === m.clientId ? m : x)) : [...ms, m]))
          api.post(`/chat/conversations/${m.conversationId}/read`).catch(() => {})
        }
        reloadList()
      }),
      on('chat:updated', (m) => {
        if (m.conversationId !== activeRef.current) return
        setMessages((ms) => ms.map((x) => (x.id === m.id ? m : x)))
        refreshInfo(m.conversationId)
      }),
      on('chat:typing', ({ conversationId }) => {
        if (conversationId === activeRef.current) { setTyping(true); setTimeout(() => setTyping(false), 2500) }
      }),
      on('presence', () => reloadList()),
      on('connect', flush),
    ]
    return () => offs.forEach((f) => f())
  }, [on, reloadList, flush, refreshInfo])

  const post = async (conversationId, payload, optimistic) => {
    setMessages((ms) => [...ms, optimistic])
    try {
      const { data } = await api.post(`/chat/conversations/${conversationId}/messages`, payload)
      // A background check may have delivered the same message first.
      setMessages((ms) => ms.filter((m) => m.id !== data.message.id).map((m) => (m.clientId === payload.clientId ? data.message : m)))
    } catch (err) {
      if (err.response) {
        setMessages((ms) => ms.filter((m) => m.clientId !== payload.clientId))
        toast.error(errorMessage(err))
      } else queue.current.push({ conversationId, payload })
    }
  }

  // Each file goes as its own message, and the words travel with the first one.
  const send = async (e) => {
    e?.preventDefault()
    if ((!text.trim() && !files.length) || uploading) return
    const conversationId = activeId
    const parts = files.length ? files : [null]
    const reply = quoting
    const body = text.trim() || null
    setText('')
    setFiles([])
    setQuoting(null)
    for (const [i, file] of parts.entries()) {
      const clientId = crypto.randomUUID()
      const first = i === 0
      const payload = { body: first ? body : null, attachmentId: file?.id, clientId, replyToId: first ? reply?.id : undefined }
      const optimistic = {
        clientId, senderId: user.id, senderName: user.name, body: payload.body, attachment: file, createdAt: new Date().toISOString(), sending: true,
        reply: first && reply ? { id: reply.id, senderName: reply.senderName, body: reply.body, fileName: reply.attachment?.name } : null,
      }
      await post(conversationId, payload, optimistic)
    }
  }

  const addFiles = async (picked) => {
    const list = [...picked]
    const tooBig = list.filter((f) => f.size > MAX_MB * 1048576)
    if (tooBig.length) toast.error(`Files can be up to ${MAX_MB} MB`)
    await Promise.all(list.filter((f) => !tooBig.includes(f)).map(async (f) => {
      setUploading((n) => n + 1)
      try {
        const uploaded = await uploadFile(f, 'chat')
        setFiles((current) => [...current, uploaded])
      } catch (err) {
        toast.error(errorMessage(err))
      } finally {
        setUploading((n) => n - 1)
      }
    }))
  }
  const attach = (e) => {
    const picked = [...e.target.files]
    e.target.value = ''
    addFiles(picked)
  }
  const dropFiles = (e) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
  }
  const pasteFiles = (e) => {
    if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files) }
  }

  const act = (fn) => async (m) => { try { await fn(m) } catch (err) { toast.error(errorMessage(err)) } }
  const saveEdit = async (e) => {
    e.preventDefault()
    try {
      await api.patch(`/chat/messages/${editing.id}`, { body: editing.body })
      setEditing(null)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const pin = async (m) => {
    const { data } = await api.post(`/chat/messages/${m.id}/pin`)
    setMessages((ms) => ms.map((x) => (x.id === m.id ? data.message : x)))
    toast.success(data.message.pinned ? 'Message pinned' : 'Message unpinned')
    await refreshInfo(activeId)
  }
  const jump = (id) => {
    const el = document.getElementById(`message-${id}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    else toast('That message is further back in this conversation')
  }
  const placeCall = (video) => { setCallMenu(false); startCall(activeId, video) }
  // Opened before the wait, because browsers block a new tab that isn't a direct result of the click.
  const startMeeting = async (provider) => {
    setCallMenu(false)
    const tab = window.open('', '_blank')
    try {
      const { data } = await api.post(`/chat/conversations/${activeId}/online-meeting`, { provider: 'GOOGLE' })
      if (tab) tab.location.href = data.url
      else window.open(data.url, '_blank')
    } catch (err) {
      const { code, url } = err.response?.data || {}
      if (code === 'CONNECT_NEEDED') {
        tab?.close()
        window.location.href = url
      } else if (code === 'NOT_SET_UP') {
        if (tab) tab.location.href = MEETINGS[provider][1]
        setMeeting(provider)
      } else {
        tab?.close()
        toast.error(errorMessage(err))
      }
    }
  }
  const exportChat = async (reason) => {
    await download(`/chat/conversations/${activeId}/export`, 'conversation.txt', { method: 'post', data: { reason } }).catch((e) => toast.error(errorMessage(e)))
    setExporting(false)
  }

  const conv = info?.conversation
  const today = companyToday()
  const open = (id) => { setNewChat(false); setSearching(false); setActiveId(id) }
  const title = conv?.type === 'CHANNEL' ? `# ${conv.name}` : [...(list?.direct || [])].find((c) => c.id === activeId)?.name || conv?.name
  let lastDay = null
  return (
    <>
      <PageHeader title="Chat" subtitle="Team channels and direct messages · presence follows check-in status" />
      <div className="grid h-[calc(100vh-170px)] min-h-[480px] overflow-hidden rounded-xl2 border border-line lg:grid-cols-[260px_1fr_220px]">
        <aside className="hidden flex-col gap-2 overflow-y-auto bg-subtle/60 p-3 md:flex">
          <button className="btn-outline w-full justify-start" onClick={() => setSearching(true)}><Search size={14} />Search people or messages</button>
          <div className="eyebrow mt-2 px-1">Channels</div>
          {list?.channels.map((c) => <Row key={c.id} c={c} active={c.id === activeId} onClick={() => setActiveId(c.id)} />)}
          <div className="eyebrow mt-2 px-1">Direct messages</div>
          {list?.direct.map((c) => <Row key={c.id} c={c} active={c.id === activeId} onClick={() => setActiveId(c.id)} />)}
          <button className="btn-outline mt-1 w-full" onClick={() => setNewChat(true)}><Plus size={14} />New message</button>
        </aside>

        <section className={`flex min-h-0 min-w-0 flex-col bg-card ${dragging ? 'ring-2 ring-inset ring-brand' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }} onDrop={dropFiles}>
          <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-bold">{title || '…'}</div>
              <div className="text-xs text-ink-muted">{info?.members.length} member{info?.members.length === 1 ? '' : 's'}{conv?.department ? ` · ${conv.department} department` : ''}</div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button className="btn-outline !p-2 md:hidden" onClick={() => setNewChat(true)} aria-label="New message"><Plus size={15} /></button>
              <div className="relative">
                <button className="btn-outline !p-2" onClick={() => setCallMenu(!callMenu)} aria-label="Start a call" aria-expanded={callMenu} disabled={!conv || conv.type === 'BOT'}><Video size={15} /></button>
                {callMenu && (
                  <div className="absolute right-0 z-20 mt-1 w-56 rounded-xl border border-line bg-card p-1 shadow-pop" role="menu">
                    <button role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-subtle" onClick={() => placeCall(true)}><Video size={14} />Video call</button>
                    <button role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-subtle" onClick={() => placeCall(false)}><Phone size={14} />Voice call</button>
                    <div className="my-1 border-t border-line" />
                    <button role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-subtle" onClick={() => startMeeting('google')}><ExternalLink size={14} />Google Meet</button>
                  </div>
                )}
              </div>
              <button className="btn-outline !p-2" onClick={() => setSearching(true)} aria-label="Search"><Search size={15} /></button>
              {conv?.canExport && <button className="btn-outline !p-2" onClick={() => setExporting(true)} aria-label="Export conversation"><Download size={15} /></button>}
            </div>
          </header>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {!info && activeId && <div className="flex justify-center py-8"><Spinner /></div>}
            {info && !messages.length && <Empty>No messages yet. Say hello.</Empty>}
            {messages.map((m) => {
              const day = dayOf(m.createdAt)
              const divider = day !== lastDay
              lastDay = day
              return (
                <div key={m.id || m.clientId}>
                  {divider && <div className="py-1 text-center text-xs text-ink-muted">{day === today ? 'Today' : fmtDay(day, 'EEE d MMM')}</div>}
                  <Message
                    m={m} mine={m.senderId === user.id} onEdit={(x) => setEditing({ id: x.id, body: x.body })}
                    onDelete={act((x) => api.delete(`/chat/messages/${x.id}`).then(({ data }) => setMessages((ms) => ms.map((y) => (y.id === x.id ? data.message : y)))))} onPin={act(pin)}
                    onQuote={setQuoting} onForward={setForwarding} onJoin={(id) => joinCall(id)} onJump={jump}
                  />
                </div>
              )
            })}
            <div ref={bottom} />
          </div>
          {typing && <div className="px-4 text-xs italic text-ink-muted">Someone is typing…</div>}
          {info && !conv.canPost ? (
            <div className="border-t border-line bg-subtle px-4 py-3 text-[13px] text-ink-soft">
              {conv.type === 'BOT' ? 'HR Assistant only sends notifications.' : '#announcements is read-only for staff. Only HR and managers can post here.'}
            </div>
          ) : (
            <form onSubmit={send} className="border-t border-line p-3">
              {quoting && (
                <div className="mb-2 flex items-start gap-2 rounded-lg border-l-2 border-brand bg-subtle px-2.5 py-1.5 text-xs">
                  <span className="min-w-0 flex-1"><b>{quoting.senderName}</b><span className="line-clamp-1 text-ink-muted">{quoteText(quoting)}</span></span>
                  <button type="button" onClick={() => setQuoting(null)} aria-label="Remove quote"><X size={12} /></button>
                </div>
              )}
              {(files.length > 0 || uploading > 0) && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {files.map((f) => <div key={f.id} className="inline-flex items-center gap-2 rounded-lg bg-subtle px-2.5 py-1 text-xs"><Paperclip size={12} />{f.name}<span className="text-ink-muted">{fileSize(f.size)}</span><button type="button" onClick={() => setFiles(files.filter((x) => x.id !== f.id))} aria-label={`Remove ${f.name}`}><X size={12} /></button></div>)}
                  {uploading > 0 && <span className="inline-flex items-center gap-2 rounded-lg bg-subtle px-2.5 py-1 text-xs"><Spinner className="!h-3 !w-3" />Uploading…</span>}
                </div>
              )}
              <div className="flex items-center gap-2">
                <label className="btn-outline cursor-pointer !p-2.5" aria-label="Attach a file"><Paperclip size={15} /><input type="file" multiple className="hidden" onChange={attach} /></label>
                <input
                  className="input" placeholder={`Message ${conv?.name || ''}`} aria-label="Message" value={text}
                  onPaste={pasteFiles} onChange={(e) => { setText(e.target.value); socket.current?.emit('typing', { conversationId: activeId }) }}
                />
                <button className="btn-primary" disabled={(!text.trim() && !files.length) || uploading > 0}><Send size={14} />Send</button>
              </div>
            </form>
          )}
        </section>

        <aside className="hidden flex-col overflow-y-auto border-l border-line bg-card p-4 lg:flex">
          <h3 className="text-[13px] font-bold">Members</h3>
          <div className="mt-2 space-y-2">
            {info?.members.slice(0, 40).map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="flex min-w-0 items-center gap-1.5"><Avatar name={m.name} size={22} /><span className="truncate">{m.name}</span></span>
                <Pill tone={m.presence?.dnd ? 'bad' : presenceTone[m.presence?.status]}>{m.presence?.dnd ? 'DND' : { in: 'Checked in', leave: 'On leave', offline: 'Offline' }[m.presence?.status]}</Pill>
              </div>
            ))}
          </div>
          <h3 className="mt-4 text-[13px] font-bold">Pinned</h3>
          <div className="mt-1 space-y-1">
            {!info?.pins.length && <p className="text-xs text-ink-muted">Nothing pinned.</p>}
            {info?.pins.map((p) => (
              <div key={p.id} className="flex items-start gap-1 rounded-lg px-1 py-1 text-xs hover:bg-subtle">
                <Pin size={12} className="mt-0.5 shrink-0 text-brand-ink" />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => jump(p.id)}><span className="block font-semibold">{p.senderName}</span><span className="line-clamp-2 text-ink-soft">{p.attachment?.name || p.body}</span></button>
                <button type="button" className="shrink-0 text-ink-muted" onClick={() => act(pin)(p)} aria-label="Unpin message"><X size={12} /></button>
              </div>
            ))}
          </div>
          <p className="mt-auto rounded-lg bg-subtle p-2.5 text-[11px] text-ink-muted">Messages follow the company chat policy. #announcements is read-only for staff; HR and managers can post.</p>
        </aside>
      </div>
      {newChat && <NewChat onClose={() => setNewChat(false)} onOpen={open} />}
      {searching && <SearchPanel onClose={() => setSearching(false)} onOpen={open} conversationId={activeId} />}
      {forwarding && list && <ForwardModal message={forwarding} list={list} onClose={() => setForwarding(null)} />}
      {meeting && <ShareMeeting provider={meeting} conversationId={activeId} onClose={() => setMeeting(null)} />}
      {exporting && <ReasonModal title="Export this conversation" label="Reason (recorded in the audit log)" confirm="Export" onClose={() => setExporting(false)} onConfirm={exportChat} />}
      {editing && (
        <Modal title="Edit message" onClose={() => setEditing(null)}>
          <form onSubmit={saveEdit} className="space-y-3">
            <textarea className="input" rows={3} aria-label="Message" value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
            <button className="btn-primary w-full">Save</button>
          </form>
        </Modal>
      )}
    </>
  )
}
