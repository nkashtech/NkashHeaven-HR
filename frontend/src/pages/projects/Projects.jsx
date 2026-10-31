import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Calendar as CalendarIcon, Clock3, Download, LayoutGrid, List, Plus, Search, Star } from 'lucide-react'
import { useFetch } from '../../components/hooks'
import { Avatar, Field, Modal, PageError, PageHeader, PageLoader, Pill, Segmented, Table } from '../../components/ui'
import { DropColumn, HEALTH, ProjectsNav, fail } from './shared'
import { addDays, companyToday, fmtDay, fmtRange, hhmm, mondayOf } from '../../utils/format'
import api from '../../services/api'
import ImportProjects from './ImportProjects'

function Remaining({ p }) {
  if (p.remainingHours === null) return null
  const over = p.remainingHours < 0
  return <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${over ? 'border-bad text-bad' : 'border-line text-ink-soft'}`} title="Hours left of the allocation">{over ? '-' : ''}{hhmm(Math.abs(p.remainingHours))}</span>
}

function ProjectCard({ p, onFavorite }) {
  const navigate = useNavigate()
  return (
    <article
      draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', String(p.id))} onClick={() => navigate(`/projects/${p.id}/tasks`)}
      className="cursor-pointer rounded-xl border border-line bg-card p-3 shadow-soft transition hover:border-brand/40" style={{ borderLeft: `3px solid ${HEALTH[p.health][2]}` }}
    >
      <div className="flex items-start gap-2">
        <button aria-label={p.favorite ? 'Remove from favourites' : 'Add to favourites'} onClick={(e) => { e.stopPropagation(); onFavorite(p) }} className={p.favorite ? 'text-warn' : 'text-ink-muted hover:text-warn'}><Star size={15} fill={p.favorite ? 'currentColor' : 'none'} /></button>
        <div className="min-w-0 flex-1">
          <Link to={`/projects/${p.id}`} onClick={(e) => e.stopPropagation()} className="line-clamp-2 text-[13px] font-semibold hover:underline">{p.name}</Link>
          {p.customer && <div className="truncate text-xs text-ink-muted">{p.customer}</div>}
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <span className="text-xs font-bold text-teal">{p.tasksTotal} {p.taskLabel}</span>
        <Remaining p={p} />
        {p.nextActivity && <span title={`${p.nextActivity.summary}, due ${p.nextActivity.dueDate}`}><Clock3 size={13} className="text-warn" /></span>}
        <span className="ml-auto flex items-center gap-1.5">{p.manager && <Avatar name={p.manager.name} size={24} photoFileId={p.manager.photoFileId} />}<span className="h-3.5 w-3.5 rounded-full" title={HEALTH[p.health][1]} style={{ background: HEALTH[p.health][2] }} /></span>
      </div>
    </article>
  )
}

function NewProject({ stages, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', stageId: stages[0]?.id || '', taskLabel: 'Tasks', customer: '' })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    try {
      const { data } = await api.post('/projects', form)
      onSaved(data.project)
    } catch (err) { fail(err) }
  }
  return (
    <Modal title="Create a project" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Project name"><input autoFocus required className="input" value={form.name} onChange={set('name')} /></Field>
        <Field label="Stage"><select className="input" value={form.stageId} onChange={set('stageId')}>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name of the tasks"><input className="input" value={form.taskLabel} onChange={set('taskLabel')} /></Field>
          <Field label="Customer"><input className="input" value={form.customer} onChange={set('customer')} /></Field>
        </div>
        <div className="flex justify-end gap-2"><button type="button" className="btn-outline" onClick={onClose}>Cancel</button><button className="btn-primary">Create</button></div>
      </form>
    </Modal>
  )
}

function ProjectCalendar({ projects }) {
  const [anchor, setAnchor] = useState(companyToday())
  const first = `${anchor.slice(0, 7)}-01`
  const start = mondayOf(first)
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i))
  const move = (n) => { const d = new Date(`${anchor}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); setAnchor(d.toISOString().slice(0, 10)) }
  return (
    <div>
      <div className="mb-2 flex items-center gap-2"><button className="btn-outline btn-sm" onClick={() => move(-1)}>Prev</button><button className="btn-outline btn-sm" onClick={() => move(1)}>Next</button><b className="text-[13px]">{fmtDay(anchor, 'MMMM yyyy')}</b><span className="text-xs text-ink-muted">Project end dates</span></div>
      <div className="grid grid-cols-7 overflow-hidden rounded-xl2 border border-line bg-card">
        {days.map((d) => (
          <div key={d} className={`min-h-[84px] border-l border-t border-line p-1 ${d.slice(0, 7) === anchor.slice(0, 7) ? '' : 'bg-subtle/50'}`}>
            <div className="text-[11px] text-ink-muted">{Number(d.slice(8))}</div>
            {projects.filter((p) => p.plannedEnd === d).map((p) => <Link key={p.id} to={`/projects/${p.id}`} className="block truncate rounded bg-brand-soft px-1 text-[11px] font-medium text-brand-ink">{p.name}</Link>)}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Projects() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [view, setView] = useState('kanban')
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const url = `/projects?${filter === 'mine' ? 'mine=true' : filter === 'favorites' ? 'favorites=true' : ''}`
  const { data, error, reload, setData } = useFetch(url)
  const projects = useMemo(() => (data?.projects || []).filter((p) => p.name.toLowerCase().includes(q.toLowerCase())), [data, q])
  if (error) return <PageError message={error} onRetry={reload} />
  if (!data) return <PageLoader />

  const moveTo = (stageId) => async (id) => {
    const p = data.projects.find((x) => x.id === id)
    if (!p || p.stageId === stageId) return
    setData({ ...data, projects: data.projects.map((x) => (x.id === id ? { ...x, stageId } : x)) })
    try { await api.patch(`/projects/${id}`, { stageId }) } catch (err) { fail(err); reload() }
  }
  const favorite = (p) => api.post(`/projects/${p.id}/favorite`).then(reload).catch(fail)
  const none = projects.filter((p) => !data.stages.some((s) => s.id === p.stageId))
  return (
    <>
      <PageHeader title="Projects" subtitle="Every project, its stage, tasks and budget">
        {data.canManage && <button className="btn-outline" onClick={() => setImporting(true)}><Download size={14} />Import from ClickUp</button>}
        {data.canCreate && <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={14} />New</button>}
      </PageHeader>
      <ProjectsNav />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input className="input !pl-9" placeholder="Search projects" aria-label="Search projects" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Segmented value={filter} onChange={setFilter} options={[['all', 'All'], ['mine', 'My projects'], ['favorites', 'Favourites']]} />
        <div className="inline-flex overflow-hidden rounded-xl border border-line bg-card">
          {[['kanban', LayoutGrid, 'Kanban'], ['list', List, 'List'], ['calendar', CalendarIcon, 'Calendar']].map(([k, Icon, label]) => (
            <button key={k} aria-label={label} title={label} onClick={() => setView(k)} className={`p-2.5 ${view === k ? 'bg-brand-soft text-brand-ink' : 'text-ink-soft hover:bg-subtle'}`}><Icon size={15} /></button>
          ))}
        </div>
      </div>
      {view === 'kanban' && (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {data.stages.map((s) => {
            const list = projects.filter((p) => p.stageId === s.id)
            return <DropColumn key={s.id} title={s.name} count={list.length} onDrop={moveTo(s.id)}>{list.map((p) => <ProjectCard key={p.id} p={p} onFavorite={favorite} />)}</DropColumn>
          })}
          {none.length > 0 && <DropColumn title="No stage" count={none.length} onDrop={moveTo(null)}>{none.map((p) => <ProjectCard key={p.id} p={p} onFavorite={favorite} />)}</DropColumn>}
        </div>
      )}
      {view === 'list' && (
        <Table>
          <thead className="bg-subtle"><tr><th className="th">Project</th><th className="th">Stage</th><th className="th">Manager</th><th className="th">Planned</th><th className="th">Tasks</th><th className="th">Hours</th><th className="th">Status</th></tr></thead>
          <tbody className="divide-y divide-line">
            {projects.map((p) => (
              <tr key={p.id} className="cursor-pointer hover:bg-subtle/50" onClick={() => navigate(`/projects/${p.id}`)}>
                <td className="td font-semibold">{p.name}</td><td className="td">{p.stage || '—'}</td><td className="td">{p.manager?.name || '—'}</td>
                <td className="td whitespace-nowrap">{p.plannedStart && p.plannedEnd ? fmtRange(p.plannedStart, p.plannedEnd) : '—'}</td>
                <td className="td">{p.tasksDone} / {p.tasksTotal}</td><td className="td tabular-nums">{hhmm(p.hoursSpent)}{p.allocatedHours ? ` / ${hhmm(p.allocatedHours)}` : ''}</td>
                <td className="td"><Pill tone={HEALTH[p.health][0]}>{HEALTH[p.health][1]}</Pill></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {view === 'calendar' && <ProjectCalendar projects={projects} />}
      {creating && <NewProject stages={data.stages} onClose={() => setCreating(false)} onSaved={(p) => navigate(`/projects/${p.id}`)} />}
      {importing && <ImportProjects stages={data.stages} onClose={() => setImporting(false)} onDone={reload} />}
    </>
  )
}

