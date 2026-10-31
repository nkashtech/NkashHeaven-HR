import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Download, Hash, Paperclip, Pencil, Pin, Plus, Search, Send, Trash2, Video, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../contexts/AuthContext'
import { useLive } from '../contexts/LiveContext'
import { Avatar, Empty, Field, Modal, PageHeader, Pill, ReasonModal, Spinner } from '../components/ui'
import { useFetch } from '../components/hooks'
import { companyToday, dayOf, fmtDay, fmtTime } from '../utils/format'
import api, { download, errorMessage, uploadFile } from '../services/api'

const presenceTone = { in: 'ok', leave: 'info', offline: 'neutral' }
const presenceText = (p) => (p ? (p.dnd ? 'Do not disturb' : p.label) : '')

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

function Message({ m, mine, onEdit, onDelete, onPin }) {
  const editable = mine && !m.deleted && Date.now() - new Date(m.createdAt) < 15 * 60000
  const openFile = () => download(`/files/${m.attachment.id}`, m.attachment.name).catch((e) => toast.error(errorMessage(e)))
  return (
    <div className="group flex gap-2.5">
      <Avatar name={m.senderName} size={32} />
      <div className="min-w-0 max-w-[75%]">
        <div className="text-[11px] text-ink-muted">
          <b className="text-ink">{m.senderName}</b>{m.formerEmployee && ' (former employee)'} · {fmtTime(m.createdAt)}{m.edited && ' · edited'}{m.pinned && ' · pinned'}{m.sending && ' · Sending…'}
        </div>
        <div className={`mt-0.5 inline-block rounded-xl px-3 py-2 text-[13px] ${m.deleted ? 'italic text-ink-muted' : 'bg-subtle'}`}>
          {m.deleted ? 'Message deleted' : <span className="whitespace-pre-wrap break-words">{m.body}</span>}
          {m.attachment && <button onClick={openFile} className="mt-1 flex items-center gap-1.5 font-semibold text-brand-ink"><Paperclip size={13} />{m.attachment.name}</button>}
          {m.link && !m.deleted && (m.link.startsWith('http')
            ? <a className="link mt-1 block" href={m.link} target="_blank" rel="noreferrer">Join call</a>
            : <Link className="link mt-1 block" to={m.link}>Open</Link>)}
        </div>
      </div>
      {!m.deleted && !m.sending && m.id && (
        <div className="invisible flex items-center gap-1 self-center group-hover:visible">
          {m.senderId !== null && <button className="rounded p-1 text-ink-muted hover:bg-subtle" onClick={() => onPin(m)} aria-label="Pin message"><Pin size={13} /></button>}
          {editable && <button className="rounded p-1 text-ink-muted hover:bg-subtle" onClick={() => onEdit(m)} aria-label="Edit message"><Pencil size={13} /></button>}
          {editable && <button className="rounded p-1 text-ink-muted hover:bg-subtle" onClick={() => onDelete(m)} aria-label="Delete message"><Trash2 size={13} /></button>}
        </div>
      )}
    </div>
  )
}

export default function Chat() {
  const { user } = useAuth()
  const { on, socket, setUnreadChat } = useLive()
  const [params, setParams] = useSearchParams()
  const { data: list, reload: reloadList } = useFetch('/chat/conversations')
  const [activeId, setActiveId] = useState(params.get('c') ? Number(params.get('c')) : null)
  const [info, setInfo] = useState(null)
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [file, setFile] = useState(null)
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
    setParams({ c: activeId }, { replace: true })
    load(activeId).catch((e) => toast.error(errorMessage(e)))
  }, [activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { bottom.current?.scrollIntoView() }, [messages])

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
        if (m.conversationId === activeRef.current) {
          setMessages((ms) => (ms.some((x) => x.id === m.id || (m.clientId && x.clientId === m.clientId)) ? ms.map((x) => (x.clientId && x.clientId === m.clientId ? m : x)) : [...ms, m]))
          api.post(`/chat/conversations/${m.conversationId}/read`).catch(() => {})
        }
        reloadList()
      }),
      on('chat:updated', (m) => {
        setMessages((ms) => ms.map((x) => (x.id === m.id ? m : x)))
        if (m.conversationId === activeRef.current) api.get(`/chat/conversations/${m.conversationId}`).then((r) => setInfo(r.data)).catch(() => {})
      }),
      on('chat:typing', ({ conversationId }) => {
        if (conversationId === activeRef.current) { setTyping(true); setTimeout(() => setTyping(false), 2500) }
      }),
      on('presence', () => reloadList()),
      on('connect', flush),
    ]
    return () => offs.forEach((f) => f())
  }, [on, reloadList, flush])

  const send = async (e) => {
    e?.preventDefault()
    if (!text.trim() && !file) return
    const clientId = crypto.randomUUID()
    const payload = { body: text.trim() || null, attachmentId: file?.id, clientId }
    const conversationId = activeId
    const optimistic = { clientId, senderId: user.id, senderName: user.name, body: payload.body, attachment: file, createdAt: new Date().toISOString(), sending: true }
    setMessages((ms) => [...ms, optimistic])
    setText('')
    setFile(null)
    try {
      const { data } = await api.post(`/chat/conversations/${conversationId}/messages`, payload)
      setMessages((ms) => ms.map((m) => (m.clientId === clientId ? data.message : m)))
    } catch (err) {
      if (err.response) {
        setMessages((ms) => ms.filter((m) => m.clientId !== clientId))
        toast.error(errorMessage(err))
      } else queue.current.push({ conversationId, payload })
    }
  }

  const attach = async (e) => {
    const f = e.target.files[0]
    e.target.value = ''
    if (!f) return
    if (f.size > 20 * 1048576) { toast.error('Files can be up to 20 MB'); return }
    try {
      setFile(await uploadFile(f, 'chat'))
    } catch (err) {
      toast.error(errorMessage(err))
    }
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
  const call = async () => {
    try {
      const { data } = await api.post(`/chat/conversations/${activeId}/call`)
      window.open(data.url, '_blank', 'noreferrer')
    } catch (err) {
      toast.error(errorMessage(err))
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

        <section className="flex min-h-0 min-w-0 flex-col bg-card">
          <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-bold">{title || '…'}</div>
              <div className="text-xs text-ink-muted">{info?.members.length} member{info?.members.length === 1 ? '' : 's'}{conv?.department ? ` · ${conv.department} department` : ''}</div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button className="btn-outline !p-2 md:hidden" onClick={() => setNewChat(true)} aria-label="New message"><Plus size={15} /></button>
              <button className="btn-outline !p-2" onClick={call} aria-label="Start video call" disabled={conv?.type === 'BOT'}><Video size={15} /></button>
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
                    onDelete={act((x) => api.delete(`/chat/messages/${x.id}`))} onPin={act((x) => api.post(`/chat/messages/${x.id}/pin`))}
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
              {file && <div className="mb-2 inline-flex items-center gap-2 rounded-lg bg-subtle px-2.5 py-1 text-xs"><Paperclip size={12} />{file.name}<button type="button" onClick={() => setFile(null)} aria-label="Remove file"><X size={12} /></button></div>}
              <div className="flex items-center gap-2">
                <label className="btn-outline cursor-pointer !p-2.5" aria-label="Attach a file"><Paperclip size={15} /><input type="file" className="hidden" onChange={attach} /></label>
                <input
                  className="input" placeholder={`Message ${conv?.name || ''}`} aria-label="Message" value={text}
                  onChange={(e) => { setText(e.target.value); socket.current?.emit('typing', { conversationId: activeId }) }}
                />
                <button className="btn-primary" disabled={!text.trim() && !file}><Send size={14} />Send</button>
              </div>
            </form>
          )}
        </section>

        <aside className="hidden flex-col overflow-y-auto border-l border-line bg-card p-4 lg:flex">
          <h3 className="text-[13px] font-bold">Members</h3>
          <div className="mt-2 space-y-2">
            {info?.members.slice(0, 40).map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="truncate">{m.name}</span>
                <Pill tone={m.presence?.dnd ? 'bad' : presenceTone[m.presence?.status]}>{m.presence?.dnd ? 'DND' : { in: 'Checked in', leave: 'On leave', offline: 'Offline' }[m.presence?.status]}</Pill>
              </div>
            ))}
          </div>
          <h3 className="mt-4 text-[13px] font-bold">Pinned</h3>
          <div className="mt-1 space-y-1">
            {!info?.pins.length && <p className="text-xs text-ink-muted">Nothing pinned.</p>}
            {info?.pins.map((p) => <div key={p.id} className="flex items-start gap-1.5 text-xs"><Paperclip size={12} className="mt-0.5 shrink-0" /><span className="line-clamp-2">{p.attachment?.name || p.body}</span></div>)}
          </div>
          <p className="mt-auto rounded-lg bg-subtle p-2.5 text-[11px] text-ink-muted">Messages follow the company chat policy. #announcements is read-only for staff; HR and managers can post.</p>
        </aside>
      </div>
      {newChat && <NewChat onClose={() => setNewChat(false)} onOpen={open} />}
      {searching && <SearchPanel onClose={() => setSearching(false)} onOpen={open} conversationId={activeId} />}
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
