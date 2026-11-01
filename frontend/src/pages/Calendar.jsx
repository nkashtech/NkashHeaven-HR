import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronLeft, ChevronRight, Clock, MapPin, Plus, RefreshCw, Users, Video, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../contexts/AuthContext'
import { useLive } from '../contexts/LiveContext'
import { useFetch } from '../components/hooks'
import { Avatar, Card, Empty, Field, Modal, PageHeader, Pill, Segmented } from '../components/ui'
import { addDays, ago, companyToday, dayOf, fmtDay, fmtRange, fmtTime, mondayOf } from '../utils/format'
import api, { errorMessage } from '../services/api'

const START_HOUR = 7
const END_HOUR = 19
const HOUR_PX = 48
const SOURCES = [
  ['google', 'Google meetings', '#2F62E3'], ['leave', 'Leave, holidays, birthdays', '#E2744A'], ['company', 'Company events', '#3D9A8B'],
]
const groupOf = (s) => (['leave', 'teamleave', 'holiday', 'birthday'].includes(s) ? 'leave' : s)

export function connectCalendar(provider) {
  api.get(`/calendar/connect/${provider.toLowerCase()}`).then((r) => { window.location.href = r.data.url }).catch((e) => toast.error(errorMessage(e)))
}

function Connections() {
  const { data, reload } = useFetch('/calendar/connections')
  const { on } = useLive()
  useEffect(() => on('calendar:synced', reload), [on, reload])
  const sync = async (id) => {
    await api.post(`/calendar/connections/${id}/sync`).catch((e) => toast.error(errorMessage(e)))
    reload()
  }
  return (
    <Card title="Connected calendars">
      <div className="space-y-3">
        {data?.connections.map((c) => (
          <div key={c.provider} className="flex items-center gap-2.5">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${c.provider === 'GOOGLE' ? 'bg-info-soft text-info' : 'bg-subtle text-violet'}`}>{c.provider[0]}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{c.provider === 'GOOGLE' ? 'Google Calendar' : 'Outlook / Microsoft 365'}</div>
              <div className="truncate text-[11px] text-ink-muted">{c.connected ? `${c.accountEmail || ''}${c.lastSyncAt ? ` · synced ${ago(c.lastSyncAt)}` : ''}` : c.available ? 'Not connected' : 'Waiting for setup by Super Admin'}</div>
            </div>
            {c.connected && c.status === 'CONNECTED' && <button className="btn-outline !p-1.5" onClick={() => sync(c.id)} aria-label="Sync now"><RefreshCw size={13} /></button>}
            {c.connected && c.status === 'RECONNECT' && <button className="btn-primary btn-sm" onClick={() => connectCalendar(c.provider)}>Reconnect</button>}
            {!c.connected && c.available && <button className="btn-primary btn-sm" onClick={() => connectCalendar(c.provider)}>Connect</button>}
          </div>
        ))}
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-ink">N</span>
          <div><div className="text-[13px] font-semibold">Company calendar</div><div className="text-[11px] text-ink-muted">Leave, holidays, birthdays, trainings</div></div>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-ink-muted">We read your calendar and only add meetings you create here. We sync every 5 minutes and when your calendar tells us something changed. Private events show as "Busy" to your team.</p>
    </Card>
  )
}

function NewMeeting({ day, onClose, onSaved }) {
  const { can, user } = useAuth()
  const { data } = useFetch('/people/directory')
  const [form, setForm] = useState({ title: '', date: day, from: '09:00', to: '10:00', description: '', location: '', meetingUrl: '', meetingType: 'APP', audience: 'PEOPLE', attendeeIds: [] })
  const [q, setQ] = useState('')
  const [connect, setConnect] = useState(null)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    try {
      await api.post('/calendar/meetings', form)
      toast.success('Meeting created and invites sent')
      onSaved()
    } catch (err) {
      // Meet needs the person's account linked once. Coming back, they press Create again.
      if (err.response?.data?.code === 'CONNECT_NEEDED') setConnect(err.response.data.url)
      else toast.error(errorMessage(err))
    }
  }
  const toggle = (id) => setForm({ ...form, attendeeIds: form.attendeeIds.includes(id) ? form.attendeeIds.filter((x) => x !== id) : [...form.attendeeIds, id] })
  return (
    <Modal title="New meeting" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Title"><input required className="input" value={form.title} onChange={set('title')} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date"><input type="date" required className="input" value={form.date} onChange={set('date')} /></Field>
          <Field label="From"><input type="time" required className="input" value={form.from} onChange={set('from')} /></Field>
          <Field label="To"><input type="time" required className="input" value={form.to} onChange={set('to')} /></Field>
        </div>
        <Field label="Meeting type">
          <select className="input" value={form.meetingType} onChange={(e) => { setForm({ ...form, meetingType: e.target.value }); setConnect(null) }}>
            <option value="APP">In-app call (up to 6 people)</option>
            <option value="GOOGLE">Google Meet</option>
            <option value="LINK">Another meeting link</option>
            <option value="NONE">In person</option>
          </select>
        </Field>
        {connect && <div className="rounded-lg bg-subtle p-2.5 text-[13px]">Connect your account once so meetings can be created for you. <a className="link" href={connect}>Connect now</a></div>}
        {form.meetingType === 'NONE' && <Field label="Location"><input className="input" value={form.location} onChange={set('location')} /></Field>}
        {form.meetingType === 'LINK' && <Field label="Meeting link"><input type="url" required className="input" placeholder="https://" value={form.meetingUrl} onChange={set('meetingUrl')} /></Field>}
        <Field label="Details"><textarea rows={2} className="input" value={form.description} onChange={set('description')} /></Field>
        <Field label="Who">
          <select className="input" value={form.audience} onChange={set('audience')}>
            <option value="PEOPLE">Selected people</option>
            {(user.role !== 'EMPLOYEE' || user.leadsPeople) && <option value="DEPARTMENT">My department</option>}
            {can('calendar.company_events') && <option value="COMPANY">Whole company</option>}
          </select>
        </Field>
        {form.audience === 'PEOPLE' && (
          <div className="space-y-2">
            <input className="input" placeholder="Search people" aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
              {data?.people.filter((p) => p.id !== user.id && p.name.toLowerCase().includes(q.toLowerCase())).map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="accent-brand" checked={form.attendeeIds.includes(p.id)} onChange={() => toggle(p.id)} />{p.name}</label>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary">Create meeting</button>
        </div>
      </form>
    </Modal>
  )
}

const RESPONSE = { ACCEPTED: ['ok', 'Accepted'], DECLINED: ['bad', 'Declined'], PENDING: ['neutral', 'No response'] }

function EventDetail({ event, onClose, onDeleted, onAnswered }) {
  const isMeeting = event.source === 'company'
  const { data, reload } = useFetch(isMeeting ? `/calendar/meetings/${event.id.slice(1)}` : null)
  const [response, setResponse] = useState(event.myResponse)
  const remove = async () => {
    try {
      await api.delete(`/calendar/meetings/${event.id.slice(1)}`)
      onDeleted()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const answer = async (choice) => {
    try {
      await api.post(`/calendar/meetings/${event.id.slice(1)}/respond`, { answer: choice })
      setResponse(choice === 'accept' ? 'ACCEPTED' : 'DECLINED')
      reload()
      onAnswered()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const label = { google: 'Google Calendar', microsoft: 'Outlook', company: data?.type || 'Company event', holiday: 'Public holiday', leave: 'Leave', teamleave: 'Team leave', birthday: 'Birthday' }[event.source]
  const link = data?.link || event.meetingUrl
  const inApp = event.meetingUrl?.startsWith('/')
  return (
    <Modal title={event.title} onClose={onClose}>
      <div className="space-y-2 text-[13px]">
        <Pill tone="ok">{label}</Pill>
        <div className="flex items-center gap-2"><Clock size={14} />{event.allDay ? fmtDay(event.date || dayOf(event.start), 'EEE d MMM yyyy') : `${fmtDay(dayOf(event.start), 'EEE d MMM')} · ${fmtTime(event.start)}–${fmtTime(event.end)}`}</div>
        {event.location && <div className="flex items-center gap-2"><MapPin size={14} />{event.location}</div>}
        {data?.organiser && <div className="flex items-center gap-2"><Users size={14} />Organised by {data.organiser}</div>}
        {!data?.attendees?.length && event.attendeeCount > 0 && <div className="flex items-center gap-2"><Users size={14} />{event.attendeeCount} people</div>}
        {event.description && <p className="text-ink-soft">{event.description}</p>}
        {link && <p className="break-all"><b>Meeting link</b><br /><a className="link" href={link} target="_blank" rel="noreferrer">{link}</a></p>}
        {data?.attendees?.length > 0 && (
          <div className="max-h-40 space-y-1 overflow-y-auto border-t border-line pt-2">
            {data.attendees.map((a) => <div key={a.id} className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-1.5"><Avatar name={a.name} size={22} /><span className="truncate">{a.name}</span></span><Pill tone={RESPONSE[a.status][0]}>{RESPONSE[a.status][1]}</Pill></div>)}
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {event.meetingUrl && (inApp
            ? <Link className="btn-primary" to={event.meetingUrl}><Video size={14} />Join</Link>
            : <a className="btn-primary" href={event.meetingUrl} target="_blank" rel="noreferrer"><Video size={14} />Join</a>)}
          {response && <button className="btn-outline" disabled={response === 'ACCEPTED'} onClick={() => answer('accept')}><Check size={14} />Accept</button>}
          {response && <button className="btn-outline" disabled={response === 'DECLINED'} onClick={() => answer('decline')}><X size={14} />Decline</button>}
          {event.editable && <button className="btn-danger" onClick={remove}>Delete</button>}
        </div>
      </div>
    </Modal>
  )
}

const eventDays = (e) => (e.allDay ? e.date || dayOf(e.start) : dayOf(e.start))

function TimeGrid({ days, events, onOpen, today }) {
  const timed = events.filter((e) => !e.allDay)
  const allDay = events.filter((e) => e.allDay)
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)
  const cols = { gridTemplateColumns: `52px repeat(${days.length}, minmax(96px, 1fr))` }
  const place = (e) => {
    const parts = (d) => { const [h, m] = fmtTime(d).split(':').map(Number); return h + m / 60 }
    const top = Math.max(0, parts(e.start) - START_HOUR) * HOUR_PX
    const height = Math.max(22, (parts(e.end) - parts(e.start)) * HOUR_PX - 2)
    return { top, height }
  }
  return (
    <div className="overflow-x-auto rounded-xl2 border border-line bg-card">
      <div className="grid border-b border-line bg-subtle" style={cols}>
        <div />
        {days.map((d) => <div key={d} className={`border-l border-line py-2 text-center text-xs font-semibold ${d === today ? 'text-brand-ink' : ''}`}>{fmtDay(d, 'EEE d')}</div>)}
      </div>
      <div className="grid border-b border-line" style={cols}>
        <div className="py-1.5 text-center text-[10px] text-ink-muted">all-day</div>
        {days.map((d) => (
          <div key={d} className="min-h-[30px] space-y-0.5 border-l border-line p-1">
            {allDay.filter((e) => eventDays(e) === d).map((e) => (
              <button key={e.id} onClick={() => onOpen(e)} className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-semibold" style={{ background: `${e.colour}26`, color: 'rgb(var(--ink))' }}>{e.title}</button>
            ))}
          </div>
        ))}
      </div>
      <div className="grid" style={cols}>
        <div>{hours.map((h) => <div key={h} className="text-center text-[10px] text-ink-muted" style={{ height: HOUR_PX }}>{String(h).padStart(2, '0')}:00</div>)}</div>
        {days.map((d) => (
          <div key={d} className="relative border-l border-line" style={{ height: hours.length * HOUR_PX }}>
            {hours.map((h, i) => <div key={h} className="absolute left-0 right-0 border-t border-line/60" style={{ top: i * HOUR_PX }} />)}
            {timed.filter((e) => dayOf(e.start) === d).map((e) => (
              <button key={e.id} onClick={() => onOpen(e)} className="absolute left-1 right-1 overflow-hidden rounded-md border px-1.5 py-0.5 text-left" style={{ ...place(e), background: `${e.colour}1F`, borderColor: `${e.colour}55` }}>
                <div className="truncate text-[11px] font-semibold">{e.title}</div>
                <div className="truncate text-[10px] text-ink-soft">{fmtTime(e.start)}–{fmtTime(e.end)}</div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function MonthGrid({ anchor, events, onOpen, onDay, today }) {
  const first = `${anchor.slice(0, 7)}-01`
  const start = mondayOf(first)
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i))
  return (
    <div className="overflow-hidden rounded-xl2 border border-line bg-card">
      <div className="grid grid-cols-7 bg-subtle">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="py-2 text-center text-xs font-semibold">{d}</div>)}</div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const list = events.filter((e) => eventDays(e) === d)
          return (
            <div key={d} className={`min-h-[92px] border-l border-t border-line p-1 ${d.slice(0, 7) === anchor.slice(0, 7) ? '' : 'bg-subtle/50'}`}>
              <button onClick={() => onDay(d)} className={`mb-0.5 text-[11px] font-semibold ${d === today ? 'rounded-full bg-brand px-1.5 text-white' : 'text-ink-soft'}`}>{Number(d.slice(8))}</button>
              {list.slice(0, 3).map((e) => (
                <button key={e.id} onClick={() => onOpen(e)} className="mb-0.5 block w-full truncate rounded px-1 text-left text-[10px] font-medium" style={{ background: `${e.colour}22` }}>{e.title}</button>
              ))}
              {list.length > 3 && <div className="px-1 text-[10px] text-ink-muted">+{list.length - 3} more</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Agenda({ events, onOpen }) {
  const groups = useMemo(() => {
    const map = new Map()
    ;[...events].sort((a, b) => eventDays(a).localeCompare(eventDays(b))).forEach((e) => map.set(eventDays(e), [...(map.get(eventDays(e)) || []), e]))
    return [...map.entries()]
  }, [events])
  return (
    <div className="card">
      {!groups.length && <Empty>Nothing in this period.</Empty>}
      {groups.map(([day, list]) => (
        <div key={day} className="mb-3">
          <div className="eyebrow mb-1">{fmtDay(day, 'EEEE d MMMM')}</div>
          {list.map((e) => (
            <button key={e.id} onClick={() => onOpen(e)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-subtle">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: e.colour }} />
              <span className="w-24 shrink-0 text-ink-soft">{e.allDay ? 'All day' : `${fmtTime(e.start)}–${fmtTime(e.end)}`}</span>
              <span className="truncate font-medium">{e.title}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

export default function Calendar() {
  const today = companyToday()
  // A week doesn't fit a phone, so phones open on the list of what's coming up.
  const [view, setView] = useState(window.innerWidth < 768 ? 'agenda' : 'week')
  const [anchor, setAnchor] = useState(today)
  const [hidden, setHidden] = useState([])
  const [open, setOpen] = useState(null)
  const [creating, setCreating] = useState(false)

  const range = useMemo(() => {
    if (view === 'day') return { from: anchor, to: anchor }
    if (view === 'week') return { from: mondayOf(anchor), to: addDays(mondayOf(anchor), 6) }
    if (view === 'agenda') return { from: anchor, to: addDays(anchor, 30) }
    const first = mondayOf(`${anchor.slice(0, 7)}-01`)
    return { from: first, to: addDays(first, 41) }
  }, [view, anchor])

  const { data, reload } = useFetch(`/calendar/events?from=${range.from}&to=${range.to}`)
  const { data: today_ } = useFetch('/calendar/today')
  const events = (data?.events || []).filter((e) => !hidden.includes(groupOf(e.source)))
  const step = { day: 1, week: 7, agenda: 30 }[view]
  const move = (dir) => {
    if (view === 'month') {
      const d = new Date(`${anchor}T12:00:00Z`)
      d.setUTCMonth(d.getUTCMonth() + dir)
      setAnchor(d.toISOString().slice(0, 10))
    } else setAnchor(addDays(anchor, dir * step))
  }
  const days = view === 'day' ? [anchor] : Array.from({ length: 7 }, (_, i) => addDays(range.from, i))
  const title = view === 'month' ? fmtDay(anchor, 'MMMM yyyy') : fmtRange(range.from, range.to)
  const next = today_?.meetings[0]
  return (
    <>
      <PageHeader title="Calendar" subtitle="Your meetings, leave, holidays and birthdays in one view" />
      <div className="grid gap-4 xl:grid-cols-[270px_1fr]">
        <div className="order-2 space-y-4 xl:order-1">
          <Connections />
          <Card title="Show">
            <div className="space-y-2">
              {SOURCES.map(([key, label, colour]) => (
                <label key={key} className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" className="h-4 w-4 accent-brand" checked={!hidden.includes(key)} onChange={() => setHidden(hidden.includes(key) ? hidden.filter((x) => x !== key) : [...hidden, key])} />
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: colour }} />{label}
                </label>
              ))}
            </div>
          </Card>
          {next && (
            <Card title="Next up">
              <div className="text-[13px] font-semibold">{next.title} · {fmtTime(next.start)}</div>
              {next.location && <div className="text-xs text-ink-muted">{next.location}</div>}
              {next.meetingUrl && (next.meetingUrl.startsWith('/')
                ? <Link to={next.meetingUrl} className="btn-primary mt-2"><Video size={14} />Join</Link>
                : <a href={next.meetingUrl} target="_blank" rel="noreferrer" className="btn-primary mt-2"><Video size={14} />Join</a>)}
            </Card>
          )}
        </div>
        <div className="order-1 min-w-0 xl:order-2">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button className="btn-outline" onClick={() => setAnchor(today)}>Today</button>
            <button className="btn-outline !p-2" onClick={() => move(-1)} aria-label="Previous"><ChevronLeft size={16} /></button>
            <button className="btn-outline !p-2" onClick={() => move(1)} aria-label="Next"><ChevronRight size={16} /></button>
            <h2 className="text-[15px] font-bold">{title}</h2>
            <div className="ml-auto flex flex-wrap gap-2">
              <Segmented value={view} onChange={setView} options={[['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['agenda', 'Agenda']]} />
              <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={14} />New meeting</button>
            </div>
          </div>
          {(view === 'day' || view === 'week') && <TimeGrid days={days} events={events} onOpen={setOpen} today={today} />}
          {view === 'month' && <MonthGrid anchor={anchor} events={events} onOpen={setOpen} onDay={(d) => { setAnchor(d); setView('day') }} today={today} />}
          {view === 'agenda' && <Agenda events={events} onOpen={setOpen} />}
        </div>
      </div>
      {open && <EventDetail event={open} onClose={() => setOpen(null)} onDeleted={() => { setOpen(null); reload() }} onAnswered={reload} />}
      {creating && <NewMeeting day={anchor} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />}
    </>
  )
}
