import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Bell, BellOff, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../../contexts/AuthContext'
import { useFetch } from '../../components/hooks'
import { Avatar, Empty, Field, Pill } from '../../components/ui'
import { ago, companyToday, fmtDateTime, fmtDay, addDays } from '../../utils/format'
import api, { errorMessage } from '../../services/api'

export const fail = (err) => toast.error(errorMessage(err))

export const HEALTH = {
  on_track: ['ok', 'On track', 'rgb(var(--ok))'], at_risk: ['warn', 'At risk', 'rgb(var(--warn))'], off_track: ['bad', 'Off track', 'rgb(var(--bad))'],
  on_hold: ['info', 'On hold', 'rgb(var(--info))'], done: ['neutral', 'Done', 'rgb(var(--ink-muted))'],
}

export function ProjectsNav() {
  const { can } = useAuth()
  const items = [['/projects', 'Projects', true], ['/projects/dashboard', 'Dashboard'], ['/tasks', 'Tasks'], ['/projects/reporting', 'Reporting'], ['/projects/risks', 'Risk & Issue Register']]
  if (can('projects.manage')) items.push(['/projects/configuration', 'Configuration'])
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-line">
      {items.map(([to, label, end]) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => `-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold ${isActive ? 'border-brand text-brand-ink' : 'border-transparent text-ink-soft hover:text-ink'}`}>{label}</NavLink>
      ))}
    </div>
  )
}

// A column you can drop cards on.
export function DropColumn({ title, count, onDrop, children, action }) {
  const [over, setOver] = useState(false)
  return (
    <section
      className={`flex w-[300px] shrink-0 flex-col rounded-xl2 p-2 transition ${over ? 'bg-brand-soft' : 'bg-subtle/60'}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onDrop(Number(e.dataTransfer.getData('text/plain'))) }}
    >
      <div className="mb-2 flex items-center justify-between gap-2 px-1.5 py-1">
        <h3 className="truncate text-[13px] font-bold">{title}</h3>
        <span className="flex items-center gap-1 text-xs font-semibold text-ink-muted">{count}{action}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

export function usePeople() {
  const { data } = useFetch('/people/directory')
  return data?.people || []
}

export function Chatter({ entity, id }) {
  const { data, reload } = useFetch(`/projects/chatter/${entity}/${id}`)
  const { user } = useAuth()
  const people = usePeople()
  const [mode, setMode] = useState(null)
  const [body, setBody] = useState('')
  const [activity, setActivity] = useState({ summary: '', dueDate: addDays(companyToday(), 3), assigneeId: user.id })
  useEffect(() => setBody(''), [mode])
  const post = async (e) => {
    e.preventDefault()
    try {
      await api.post(`/projects/chatter/${entity}/${id}`, { body, kind: mode === 'note' ? 'NOTE' : 'MESSAGE' })
      setMode(null)
      reload()
    } catch (err) { fail(err) }
  }
  const schedule = async (e) => {
    e.preventDefault()
    try {
      await api.post(`/projects/chatter/${entity}/${id}/activities`, activity)
      setMode(null)
      setActivity({ ...activity, summary: '' })
      reload()
    } catch (err) { fail(err) }
  }
  const follow = () => api.post(`/projects/chatter/${entity}/${id}/follow`).then(reload).catch(fail)
  const done = (aid) => api.post(`/projects/activities/${aid}/done`).then(reload).catch(fail)
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button className={mode === 'message' ? 'btn-primary' : 'btn-outline'} onClick={() => setMode(mode === 'message' ? null : 'message')}>Send message</button>
        <button className={mode === 'note' ? 'btn-primary' : 'btn-outline'} onClick={() => setMode(mode === 'note' ? null : 'note')}>Log note</button>
        <button className={mode === 'activity' ? 'btn-primary' : 'btn-outline'} onClick={() => setMode(mode === 'activity' ? null : 'activity')}>Activities</button>
        <button className="btn-ghost ml-auto" onClick={follow}>{data?.following ? <BellOff size={14} /> : <Bell size={14} />}{data?.following ? 'Following' : 'Follow'} ({data?.followers ?? 0})</button>
      </div>
      {(mode === 'message' || mode === 'note') && (
        <form onSubmit={post} className="mt-3 space-y-2">
          <textarea required rows={3} className="input" aria-label={mode === 'note' ? 'Log note' : 'Message'} placeholder={mode === 'note' ? 'Internal note, followers are not notified' : 'Followers are notified'} value={body} onChange={(e) => setBody(e.target.value)} />
          <button className="btn-primary">{mode === 'note' ? 'Log' : 'Send'}</button>
        </form>
      )}
      {mode === 'activity' && (
        <form onSubmit={schedule} className="mt-3 grid gap-2 sm:grid-cols-3">
          <Field label="Summary"><input required className="input" value={activity.summary} onChange={(e) => setActivity({ ...activity, summary: e.target.value })} /></Field>
          <Field label="Due"><input required type="date" className="input" value={activity.dueDate} onChange={(e) => setActivity({ ...activity, dueDate: e.target.value })} /></Field>
          <Field label="Assigned to">
            <select className="input" value={activity.assigneeId} onChange={(e) => setActivity({ ...activity, assigneeId: e.target.value })}>
              <option value={user.id}>{user.name}</option>{people.filter((p) => p.id !== user.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-3"><button className="btn-primary">Schedule</button></div>
        </form>
      )}
      {data?.activities.length > 0 && (
        <div className="mt-3 space-y-1">
          {data.activities.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-warn-soft px-3 py-1.5 text-[13px]">
              <span><b>{a.summary}</b> · {a.assigneeName} · due {fmtDay(a.dueDate)}</span>
              <button className="btn-outline btn-sm" onClick={() => done(a.id)}><Check size={12} />Done</button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 divide-y divide-line">
        {data?.entries.map((e) => (
          <div key={e.id} className="flex gap-2.5 py-2.5">
            <Avatar name={e.authorName} size={30} />
            <div className="min-w-0 flex-1">
              <div className="text-xs"><b className="text-[13px]">{e.authorName}</b> <span className="text-ink-muted" title={fmtDateTime(e.createdAt)}>{ago(e.createdAt)}</span> {e.kind === 'NOTE' && <Pill tone="warn">Note</Pill>}</div>
              <p className={`whitespace-pre-wrap text-[13px] ${e.kind === 'TRACKING' ? 'text-ink-soft' : ''}`}>{e.body}</p>
            </div>
          </div>
        ))}
        {data && !data.entries.length && <Empty>Nothing yet.</Empty>}
      </div>
    </div>
  )
}
