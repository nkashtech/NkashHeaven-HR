import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { useFetch } from '../../components/hooks'
import { Bar, Card, Empty, Field, Kpi, PageError, PageHeader, PageLoader, Pill, Segmented, Table } from '../../components/ui'
import { DropColumn, HEALTH, ProjectsNav, fail } from './shared'
import { TaskCard, TaskModal } from './ProjectDetail'
import { addDays, companyToday, fmtDay, hhmm } from '../../utils/format'
import api from '../../services/api'

const COLOURS = ['rgb(var(--brand-bright))', 'rgb(var(--teal))', 'rgb(var(--info))', 'rgb(var(--violet))', 'rgb(var(--ink-muted))']

export function ProjectDashboard() {
  const { data, error, reload } = useFetch('/projects/dashboard')
  const navigate = useNavigate()
  if (error) return <PageError message={error} onRetry={reload} />
  if (!data) return <PageLoader />
  const max = Math.max(1, ...data.hoursByProject.map((p) => p.hours))
  return (
    <>
      <PageHeader title="Projects dashboard" subtitle="Where work stands across the company" />
      <ProjectsNav />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Active projects" value={data.projects} />
        <Kpi label="Open tasks" value={data.openTasks} />
        <Kpi label="Overdue tasks" value={data.overdue} tone={data.overdue ? 'bad' : undefined} />
        <Kpi label="My open tasks" value={data.myTasks} />
        <Kpi label="Hours this week" value={hhmm(data.hoursThisWeek)} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Project status">
          {Object.entries(HEALTH).map(([k, [tone, label]]) => <div key={k} className="flex items-center justify-between border-b border-line py-1.5 text-[13px]"><Pill tone={tone}>{label}</Pill><b>{data.health[k]}</b></div>)}
        </Card>
        <Card title="Hours by project · this week">
          {!data.hoursByProject.length && <Empty>No time logged yet.</Empty>}
          <div className="space-y-2.5">{data.hoursByProject.map((p, i) => <div key={p.name}><div className="mb-1 flex justify-between text-[13px]"><span className="truncate">{p.name}</span><b>{hhmm(p.hours)}</b></div><Bar value={p.hours} max={max} color={COLOURS[i % 5]} /></div>)}</div>
        </Card>
        <Card title="Over budget">
          {!data.overBudget.length && <Empty>Everything is within its allocation.</Empty>}
          {data.overBudget.map((p) => <button key={p.id} onClick={() => navigate(`/projects/${p.id}`)} className="flex w-full justify-between py-1.5 text-left text-[13px]"><span className="truncate">{p.name}</span><b className="text-bad">-{hhmm(Math.abs(p.remainingHours))}</b></button>)}
        </Card>
        <Card title="My activities" className="lg:col-span-3">
          {!data.activities.length && <Empty>No activities waiting for you.</Empty>}
          {data.activities.map((a) => <div key={a.id} className="flex justify-between gap-2 border-b border-line py-1.5 text-[13px]"><span>{a.summary}</span><span className={a.dueDate < companyToday() ? 'text-bad' : 'text-ink-soft'}>{fmtDay(a.dueDate)}</span></div>)}
        </Card>
      </div>
    </>
  )
}

export function AllTasks() {
  const [scope, setScope] = useState('mine')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)
  const { data, error, reload } = useFetch(`/projects/tasks?${scope === 'mine' ? 'mine=true&' : ''}open=true${q ? `&q=${encodeURIComponent(q)}` : ''}`)
  if (error) return <PageError message={error} onRetry={reload} />
  const groups = new Map()
  ;(data?.tasks || []).forEach((t) => groups.set(t.stage || 'No stage', [...(groups.get(t.stage || 'No stage') || []), t]))
  return (
    <>
      <PageHeader title="Tasks" subtitle="Open tasks across every project" />
      <ProjectsNav />
      <div className="mb-3 flex flex-wrap gap-2">
        <Segmented value={scope} onChange={setScope} options={[['mine', 'My tasks'], ['all', 'All tasks']]} />
        <input className="input max-w-xs" placeholder="Search tasks" aria-label="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!data && <PageLoader />}
      {data && !data.tasks.length && <Card><Empty>No open tasks.</Empty></Card>}
      <div className="flex gap-3 overflow-x-auto pb-3">
        {[...groups.entries()].map(([stage, list]) => <DropColumn key={stage} title={stage} count={list.length} onDrop={() => {}}>{list.map((t) => <TaskCard key={t.id} t={t} showProject onOpen={setOpen} />)}</DropColumn>)}
      </div>
      {open && <TaskModal taskId={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  )
}

export function ProjectReporting() {
  const today = companyToday()
  const [from, setFrom] = useState(addDays(today, -29))
  const [to, setTo] = useState(today)
  const { data, error, reload } = useFetch(`/projects/reporting?from=${from}&to=${to}`)
  if (error) return <PageError message={error} onRetry={reload} />
  const maxP = Math.max(1, ...(data?.byProject || []).map((p) => p.hours))
  const maxU = Math.max(1, ...(data?.byUser || []).map((p) => p.hours))
  return (
    <>
      <PageHeader title="Reporting" subtitle="Time and tasks by project and person" />
      <ProjectsNav />
      <div className="mb-3 flex gap-3">
        <Field label="From"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {!data ? <PageLoader /> : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Hours by project">{data.byProject.map((p) => <div key={p.id} className="mb-2"><div className="mb-1 flex justify-between text-[13px]"><Link to={`/projects/${p.id}`} className="truncate hover:underline">{p.name}</Link><b>{hhmm(p.hours)}</b></div><Bar value={p.hours} max={maxP} /></div>)}</Card>
          <Card title="Hours by person">{data.byUser.map((p) => <div key={p.name} className="mb-2"><div className="mb-1 flex justify-between text-[13px]"><span className="truncate">{p.name}</span><b>{hhmm(p.hours)}</b></div><Bar value={p.hours} max={maxU} color="rgb(var(--teal))" /></div>)}</Card>
          <Card title="Tasks by stage">{data.tasksByStage.map((s) => <div key={s.name} className="flex justify-between border-b border-line py-1.5 text-[13px]"><span>{s.name}</span><b>{s.count}</b></div>)}</Card>
        </div>
      )}
    </>
  )
}

export function RiskRegisterPage() {
  const [kind, setKind] = useState('')
  const { data, error, reload } = useFetch(`/projects/risks?kind=${kind}`)
  if (error) return <PageError message={error} onRetry={reload} />
  return (
    <>
      <PageHeader title="Risk & Issue Register" subtitle="Add items from each project's Register tab" />
      <ProjectsNav />
      <div className="mb-3"><Segmented value={kind} onChange={setKind} options={[['', 'All'], ['RISK', 'Risks'], ['ISSUE', 'Issues'], ['CHANGE', 'Changes']]} /></div>
      <Table>
        <thead className="bg-subtle"><tr><th className="th">Type</th><th className="th">Title</th><th className="th">Project</th><th className="th">Severity</th><th className="th">Owner</th><th className="th">Status</th></tr></thead>
        <tbody className="divide-y divide-line">
          {data && !data.items.length && <tr><td colSpan={6} className="td text-center text-ink-muted">Nothing logged.</td></tr>}
          {data?.items.map((r) => (
            <tr key={r.id}>
              <td className="td">{r.kind}</td><td className="td font-medium">{r.title}</td><td className="td"><Link className="hover:underline" to={`/projects/${r.project.id}`}>{r.project.name}</Link></td>
              <td className="td"><Pill tone={{ LOW: 'ok', MEDIUM: 'warn', HIGH: 'bad' }[r.severity]}>{r.severity}</Pill></td><td className="td">{r.ownerName || '—'}</td><td className="td">{r.status}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  )
}

export function ProjectConfiguration() {
  const { data, reload } = useFetch('/projects/stages')
  const [name, setName] = useState('')
  const add = async (e) => {
    e.preventDefault()
    try {
      await api.post('/projects/stages', { name })
      setName('')
      reload()
    } catch (err) { fail(err) }
  }
  const swap = async (i, dir) => {
    const list = data.stages
    const other = list[i + dir]
    if (!other) return
    await Promise.all([api.patch(`/projects/stages/${list[i].id}`, { sequence: i + dir }), api.patch(`/projects/stages/${other.id}`, { sequence: i })]).catch(fail)
    reload()
  }
  return (
    <>
      <PageHeader title="Configuration" subtitle="The stages your projects move through" />
      <ProjectsNav />
      <Card title="Project stages" className="max-w-xl">
        <form onSubmit={add} className="mb-3 flex gap-2"><input required className="input" placeholder="New stage" aria-label="New stage" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn-primary"><Plus size={14} />Add</button></form>
        {data?.stages.map((s, i) => (
          <div key={s.id} className="flex items-center justify-between gap-2 border-b border-line py-1.5 text-[13px]">
            <span className="font-medium">{s.name}</span>
            <span className="flex items-center gap-1">
              <button className="btn-outline btn-sm" disabled={i === 0} onClick={() => swap(i, -1)} aria-label={`Move ${s.name} up`}>↑</button>
              <button className="btn-outline btn-sm" disabled={i === data.stages.length - 1} onClick={() => swap(i, 1)} aria-label={`Move ${s.name} down`}>↓</button>
              <button className="btn-outline btn-sm" aria-label={`Remove ${s.name}`} onClick={() => api.delete(`/projects/stages/${s.id}`).then(reload).catch(fail)}><Trash2 size={12} /></button>
            </span>
          </div>
        ))}
      </Card>
    </>
  )
}
