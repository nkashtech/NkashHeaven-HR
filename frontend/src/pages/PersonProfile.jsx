import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Mail, MessageSquare, Phone } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../contexts/AuthContext'
import { useFetch } from '../components/hooks'
import { Avatar, Card, Empty, Field, Modal, PageError, PageLoader, Pill } from '../components/ui'
import { fmtDay } from '../utils/format'
import api, { errorMessage } from '../services/api'

const PersonRow = ({ p, sub }) => (
  <Link to={`/people/${p.id}`} className="flex items-center gap-2.5 rounded-lg px-1 py-1.5 hover:bg-subtle">
    <Avatar name={p.name} size={32} presence={p.presence} photoFileId={p.photoFileId} />
    <span className="min-w-0"><span className="block truncate text-[13px] font-semibold">{p.name}</span><span className="block truncate text-xs text-ink-muted">{sub || p.jobTitle}</span></span>
  </Link>
)

// HR picks anyone active as the manager. Clearing it falls back to the department's manager.
function ChangeManager({ person, onClose, onSaved }) {
  const { data } = useFetch('/employees/options')
  const [managerId, setManagerId] = useState(person.managerId || '')
  const [busy, setBusy] = useState(false)
  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.patch(`/employees/${person.id}`, { managerId: managerId || null })
      toast.success('Manager changed')
      onSaved()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={`Change ${person.name}'s manager`} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <Field label="Manager" hint="They approve this person's leave before HR, when the leave type asks for it.">
          <select className="input" value={managerId} onChange={(e) => setManagerId(e.target.value)} disabled={!data}>
            <option value="">None (use the department's manager)</option>
            {data?.managers.filter((m) => m.id !== person.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2"><button type="button" className="btn-outline" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !data}>Save</button></div>
      </form>
    </Modal>
  )
}

export default function PersonProfile() {
  const { id } = useParams()
  const { user, can } = useAuth()
  const [changing, setChanging] = useState(false)
  const navigate = useNavigate()
  const { data, error, reload } = useFetch(`/people/${id}`)
  if (error) return <PageError message={error} onRetry={reload} />
  if (!data) return <PageLoader />
  const p = data.person
  const message = async () => {
    try {
      const { data: r } = await api.post('/chat/direct', { userId: p.id })
      navigate(`/chat?c=${r.conversationId}`)
    } catch (err) { toast.error(errorMessage(err)) }
  }
  return (
    <>
      <Link to="/people" className="link mb-2 mt-1 inline-flex items-center gap-1"><ArrowLeft size={14} />People</Link>
      <Card>
        <div className="flex flex-wrap items-center gap-5">
          <Avatar name={p.name} size={88} presence={p.presence} photoFileId={p.photoFileId} />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight">{p.name}</h1>
            {p.jobTitle && <p className="text-[15px] font-semibold text-brand-ink">{p.jobTitle}</p>}
            <p className="text-[13px] text-ink-soft">{[p.team?.name, p.department].filter(Boolean).join(' · ')}</p>
            <p className="mt-1 text-[13px] text-ink-soft">Manager: {p.manager ? <Link to={`/people/${p.manager.id}`} className="font-semibold text-ink hover:underline">{p.manager.name}</Link> : 'Not set'}</p>
            <p className="mt-1 text-xs text-ink-muted">{p.presence?.label} · Joined {fmtDay(p.startDate, 'd MMM yyyy')}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-[13px] text-ink-soft">
              <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 hover:underline"><Mail size={13} />{p.email}</a>
              {p.phone && <span className="inline-flex items-center gap-1"><Phone size={13} />{p.phone}</span>}
            </div>
          </div>
          {p.id !== user.id && <button className="btn-primary" onClick={message}><MessageSquare size={14} />Message</button>}
          {p.id === user.id && <Link className="btn-outline" to="/profile">Edit my profile</Link>}
        </div>
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Manager" action={can('users.assign') && <button className="btn-outline btn-sm" onClick={() => setChanging(true)}>Change</button>}>
          {p.manager ? <PersonRow p={p.manager} /> : <Empty>No manager set.</Empty>}
          {p.team?.lead && <div className="mt-2 border-t border-line pt-2"><div className="eyebrow">Team lead</div><PersonRow p={p.team.lead} sub={p.team.name} /></div>}
        </Card>
        <Card title={`Works with${p.worksWithLabel ? ` · ${p.worksWithLabel}` : ''}`}>
          {!p.worksWith.length && <Empty>No teammates yet.</Empty>}
          <div className="max-h-80 overflow-y-auto">{p.worksWith.map((w) => <PersonRow key={w.id} p={w} />)}</div>
        </Card>
        <div className="space-y-4">
          {p.directReports.length > 0 && <Card title={`Leads ${p.directReports.length}`}><div className="max-h-52 overflow-y-auto">{p.directReports.map((w) => <PersonRow key={w.id} p={w} />)}</div></Card>}
          <Card title="Projects">
            {!p.projects.length && <Empty>No recent projects.</Empty>}
            <div className="flex flex-wrap gap-1.5">{p.projects.map((x) => <Link key={x.id} to={`/projects/${x.id}`}><Pill tone="brand">{x.name}</Pill></Link>)}</div>
          </Card>
        </div>
      </div>
      {changing && <ChangeManager person={p} onClose={() => setChanging(false)} onSaved={() => { setChanging(false); reload() }} />}
    </>
  )
}
