import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckSquare, Clock, Plus, Star, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useFetch } from '../../components/hooks'
import { Avatar, Card, Empty, Field, Modal, PageError, PageLoader, Pill, Toggle } from '../../components/ui'
import { Chatter, DropColumn, HEALTH, ProjectsNav, fail, usePeople } from './shared'
import { fmtDay, hhmm, companyToday } from '../../utils/format'
import api from '../../services/api'

const SEVERITY = { LOW: 'ok', MEDIUM: 'warn', HIGH: 'bad' }

function RiskRegister({ project, risks, reload, canEdit }) {
  const people = usePeople()
  const blank = { kind: 'RISK', title: '', severity: 'MEDIUM', ownerId: '', dueDate: '', description: '' }
  const [form, setForm] = useState(blank)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const add = async (e) => {
    e.preventDefault()
    try {
      await api.post(`/projects/${project.id}/risks`, form)
      setForm(blank)
      reload()
    } catch (err) { fail(err) }
  }
  const status = (r, value) => api.patch(`/projects/risks/${r.id}`, { status: value }).then(reload).catch(fail)
  return (
    <div>
      <form onSubmit={add} className="mb-3 grid gap-2 sm:grid-cols-5">
        <Field label="Type"><select className="input" value={form.kind} onChange={set('kind')}><option value="RISK">Risk</option><option value="ISSUE">Issue</option><option value="CHANGE">Change</option></select></Field>
        <div className="sm:col-span-2"><Field label="Title"><input required className="input" value={form.title} onChange={set('title')} /></Field></div>
        <Field label="Severity"><select className="input" value={form.severity} onChange={set('severity')}><option>LOW</option><option>MEDIUM</option><option>HIGH</option></select></Field>
        <Field label="Owner"><select className="input" value={form.ownerId} onChange={set('ownerId')}><option value="">None</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <div className="sm:col-span-5"><button className="btn-outline"><Plus size={14} />Add to register</button></div>
      </form>
      {!risks.length && <Empty>Nothing logged.</Empty>}
      <div className="divide-y divide-line">
        {risks.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-[13px]">
            <Pill>{r.kind}</Pill><Pill tone={SEVERITY[r.severity]}>{r.severity}</Pill>
            <span className="min-w-0 flex-1 font-medium">{r.title}</span>
            <span className="text-xs text-ink-muted">{r.ownerName || 'No owner'}</span>
            <select className="input !w-auto !py-1" aria-label={`Status of ${r.title}`} value={r.status} disabled={!canEdit} onChange={(e) => status(r, e.target.value)}><option value="OPEN">Open</option><option value="MITIGATING">Mitigating</option><option value="CLOSED">Closed</option></select>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data, error, reload } = useFetch(`/projects/${id}`)
  const people = usePeople()
  const { data: settings } = useFetch('/settings/departments')
  const [form, setForm] = useState(null)
  const [tab, setTab] = useState('description')
  const [tag, setTag] = useState('')
  useEffect(() => {
    if (data) {
      const p = data.project
      setForm({ name: p.name, taskLabel: p.taskLabel, tags: p.tags, managerId: p.manager?.id || '', plannedStart: p.plannedStart || '', plannedEnd: p.plannedEnd || '', allocatedHours: p.allocatedHours, description: p.description || '', customer: p.customer || '', departmentId: p.department?.id || '', billable: p.billable, health: p.health })
    }
  }, [data])
  if (error) return <PageError message={error} onRetry={reload} />
  if (!data || !form) return <PageLoader />
  const { project: p, stages, canEdit, risks, team } = data
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const save = async () => {
    try {
      await api.patch(`/projects/${id}`, form)
      toast.success('Saved')
      reload()
    } catch (err) { fail(err) }
  }
  const stage = (stageId) => canEdit && api.patch(`/projects/${id}`, { stageId }).then(reload).catch(fail)
  const favorite = () => api.post(`/projects/${id}/favorite`).then(reload).catch(fail)
  const archive = async () => {
    await api.patch(`/projects/${id}`, { active: false }).catch(fail)
    navigate('/projects')
  }
  const addTag = (e) => { e.preventDefault(); if (tag.trim()) { setForm({ ...form, tags: [...form.tags, tag.trim()] }); setTag('') } }
  const TABS = [['description', 'Description'], ['settings', 'Settings'], ['analytic', 'Analytic'], ['register', 'Risk / Issue & Change Register']]
  return (
    <>
      <div className="mb-2 mt-1 flex flex-wrap items-center justify-between gap-2">
        <Link to="/projects" className="link inline-flex items-center gap-1"><ArrowLeft size={14} />Projects</Link>
        <div className="flex gap-2">
          <Link to={`/projects/${id}/tasks`} className="btn-outline"><CheckSquare size={14} />{p.taskLabel} {p.tasksDone} / {p.tasksTotal} ({p.tasksTotal ? Math.round((p.tasksDone / p.tasksTotal) * 100) : 0}%)</Link>
          <span className="btn-outline cursor-default"><Clock size={14} />{hhmm(p.hoursSpent)} logged</span>
          {canEdit && <button className="btn-primary" onClick={save}>Save</button>}
        </div>
      </div>
      <div className="mb-3 flex overflow-x-auto rounded-xl border border-line bg-subtle/60">
        {stages.map((s) => (
          <button key={s.id} disabled={!canEdit} onClick={() => stage(s.id)} className={`shrink-0 border-r border-line px-3.5 py-2 text-[13px] font-semibold ${s.id === p.stageId ? 'bg-card text-brand-ink' : 'text-ink-soft hover:bg-card/60'}`}>{s.name}</button>
        ))}
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
          <button onClick={favorite} aria-label="Toggle favourite" className={p.favorite ? 'text-warn' : 'text-ink-muted'}><Star size={22} fill={p.favorite ? 'currentColor' : 'none'} /></button>
          <input disabled={!canEdit} aria-label="Project name" className="w-full min-w-0 flex-1 bg-transparent text-2xl font-bold tracking-tight focus:outline-none" value={form.name} onChange={set('name')} />
          <select disabled={!canEdit} aria-label="Status" className="input !w-auto font-semibold" value={form.health} onChange={set('health')}>{Object.entries(HEALTH).map(([k, v]) => <option key={k} value={k}>{v[1]}</option>)}</select>
        </div>
        <div className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <Field label="Name of the tasks"><input disabled={!canEdit} className="input" value={form.taskLabel} onChange={set('taskLabel')} /></Field>
          <Field label="Project manager"><select disabled={!canEdit} className="input" value={form.managerId} onChange={set('managerId')}><option value="">None</option>{people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
          <Field label="Tags">
            <div className="flex flex-wrap items-center gap-1.5">
              {form.tags.map((t) => <button key={t} disabled={!canEdit} onClick={() => setForm({ ...form, tags: form.tags.filter((x) => x !== t) })} title="Remove"><Pill tone="brand">{t} ×</Pill></button>)}
              {canEdit && <form onSubmit={addTag}><input className="input !w-32 !py-1" placeholder="Add a tag" aria-label="Add a tag" value={tag} onChange={(e) => setTag(e.target.value)} /></form>}
            </div>
          </Field>
          <Field label="Planned date">
            <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap"><input disabled={!canEdit} type="date" className="input min-w-0" aria-label="Planned start" value={form.plannedStart} onChange={set('plannedStart')} /><span>→</span><input disabled={!canEdit} type="date" className="input min-w-0" aria-label="Planned end" value={form.plannedEnd} onChange={set('plannedEnd')} /></div>
          </Field>
          <Field label="Customer"><input disabled={!canEdit} className="input" value={form.customer} onChange={set('customer')} /></Field>
          <Field label="Allocated time (hours)"><input disabled={!canEdit} type="number" min="0" step="0.5" className="input" value={form.allocatedHours} onChange={set('allocatedHours')} /></Field>
        </div>
        <div className="mt-5 flex flex-wrap gap-1 border-b border-line">
          {TABS.map(([k, label]) => <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold ${tab === k ? 'border-brand text-brand-ink' : 'border-transparent text-ink-soft hover:text-ink'}`}>{label}</button>)}
        </div>
        <div className="pt-4">
          {tab === 'description' && <textarea disabled={!canEdit} rows={7} className="input" placeholder="Project description…" aria-label="Project description" value={form.description} onChange={set('description')} />}
          {tab === 'settings' && (
            <div className="max-w-md space-y-3">
              <Field label="Department"><select disabled={!canEdit} className="input" value={form.departmentId} onChange={set('departmentId')}><option value="">All departments</option>{settings?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
              <div className="flex items-center justify-between text-[13px]"><span>Billable</span><Toggle label="Billable" checked={form.billable} onChange={(v) => canEdit && setForm({ ...form, billable: v })} /></div>
              {canEdit && <button className="btn-danger" onClick={archive}><Trash2 size={14} />Archive project</button>}
            </div>
          )}
          {tab === 'analytic' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="text-[13px]">
                {[['Allocated', hhmm(p.allocatedHours)], ['Spent', hhmm(p.hoursSpent)], ['Remaining', p.remainingHours === null ? '—' : `${p.remainingHours < 0 ? '-' : ''}${hhmm(Math.abs(p.remainingHours))}`], ['Tasks done', `${p.tasksDone} of ${p.tasksTotal}`]].map(([k, v]) => <div key={k} className="flex justify-between border-b border-line py-1.5"><span className="text-ink-soft">{k}</span><b>{v}</b></div>)}
              </div>
              <div>
                <div className="eyebrow mb-1">Hours by person</div>
                {!team.length && <Empty>No time logged yet.</Empty>}
                {team.map((t) => <div key={t.name} className="flex justify-between py-1 text-[13px]"><span>{t.name}</span><b>{hhmm(t.hours)}</b></div>)}
              </div>
            </div>
          )}
          {tab === 'register' && <RiskRegister project={p} risks={risks} reload={reload} canEdit={canEdit} />}
        </div>
      </Card>
      <Card className="mt-4"><Chatter entity="project" id={id} /></Card>
    </>
  )
}

export function TaskModal({ taskId, onClose, onChanged }) {
  const { data, reload } = useFetch(`/projects/tasks/${taskId}`)
  const people = usePeople()
  const [form, setForm] = useState(null)
  const [sub, setSub] = useState('')
  useEffect(() => {
    if (data) {
      const t = data.task
      setForm({ name: t.name, description: t.description || '', stageId: t.stageId || '', deadline: t.deadline || '', plannedHours: t.plannedHours, priority: t.priority, assigneeIds: t.assignees.map((a) => a.id) })
    }
  }, [data])
  if (!form) return null
  const t = data.task
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const save = async () => {
    try {
      await api.patch(`/projects/tasks/${taskId}`, form)
      toast.success('Saved')
      onChanged()
      onClose()
    } catch (err) { fail(err) }
  }
  const addSub = async (e) => {
    e.preventDefault()
    try {
      await api.post(`/projects/${t.projectId}/tasks`, { name: sub, parentId: taskId })
      setSub('')
      reload()
    } catch (err) { fail(err) }
  }
  const toggle = (id) => setForm({ ...form, assigneeIds: form.assigneeIds.includes(id) ? form.assigneeIds.filter((x) => x !== id) : [...form.assigneeIds, id] })
  return (
    <Modal title={t.project} wide onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <button aria-label="Toggle priority" onClick={() => setForm({ ...form, priority: !form.priority })} className={form.priority ? 'text-warn' : 'text-ink-muted'}><Star size={18} fill={form.priority ? 'currentColor' : 'none'} /></button>
          <input aria-label="Task name" className="input !text-[15px] font-bold" value={form.name} onChange={set('name')} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Stage"><select className="input" value={form.stageId} onChange={set('stageId')}>{data.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Deadline"><input type="date" className="input" value={form.deadline} onChange={set('deadline')} /></Field>
          <Field label="Planned hours"><input type="number" min="0" step="0.5" className="input" value={form.plannedHours} onChange={set('plannedHours')} /></Field>
        </div>
        <Field label="Assignees">
          <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-line p-2">
            {people.map((p) => <button type="button" key={p.id} onClick={() => toggle(p.id)} className={`rounded-full px-2 py-0.5 text-xs font-medium ${form.assigneeIds.includes(p.id) ? 'bg-brand text-white' : 'bg-subtle text-ink-soft'}`}>{p.name}</button>)}
          </div>
        </Field>
        <Field label="Description"><textarea rows={4} className="input" value={form.description} onChange={set('description')} /></Field>
        <div>
          <div className="eyebrow mb-1">Sub-tasks</div>
          {data.task.subtaskList.map((s) => <div key={s.id} className="flex justify-between border-b border-line py-1 text-[13px]"><span>{s.name}</span><span className="text-xs text-ink-muted">{s.stage}</span></div>)}
          <form onSubmit={addSub} className="mt-1 flex gap-2"><input className="input !py-1" required placeholder="Add a sub-task" aria-label="Add a sub-task" value={sub} onChange={(e) => setSub(e.target.value)} /><button className="btn-outline btn-sm">Add</button></form>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line pt-3"><span className="text-xs text-ink-muted">{hhmm(t.hoursSpent)} logged on this task</span><button className="btn-primary" onClick={save}>Save</button></div>
        <div className="border-t border-line pt-3"><Chatter entity="task" id={taskId} /></div>
      </div>
    </Modal>
  )
}

export function TaskCard({ t, onOpen, showProject }) {
  const late = t.deadline && t.deadline < companyToday() && !t.isDone
  return (
    <article draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', String(t.id))} onClick={() => onOpen(t.id)} className="cursor-pointer rounded-xl border border-line bg-card p-3 shadow-soft hover:border-brand/40">
      <div className="flex items-start gap-1.5">{t.priority && <Star size={13} className="mt-0.5 shrink-0 text-warn" fill="currentColor" />}<p className="line-clamp-2 text-[13px] font-semibold">{t.name}</p></div>
      {showProject && <div className="truncate text-xs text-ink-muted">{t.project}</div>}
      {t.tags.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{t.tags.slice(0, 3).map((x) => <Pill key={x} tone="brand">{x}</Pill>)}</div>}
      <div className="mt-2 flex items-center gap-2 text-xs">
        {t.deadline && <span className={late ? 'font-semibold text-bad' : 'text-ink-muted'}>{fmtDay(t.deadline, 'd MMM')}</span>}
        {t.subtasks > 0 && <span className="text-ink-muted">{t.subtasks} sub</span>}
        <span className="ml-auto flex -space-x-1.5">{t.assignees.slice(0, 3).map((a) => <Avatar key={a.id} name={a.name} size={22} photoFileId={a.photoFileId} />)}</span>
      </div>
    </article>
  )
}

export function ProjectTasks() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const { data: info, reload: reloadInfo } = useFetch(`/projects/${id}`)
  const { data, reload, setData } = useFetch(`/projects/tasks?projectId=${id}`)
  const [adding, setAdding] = useState(null)
  const [newStage, setNewStage] = useState('')
  const open = params.get('task')
  if (!info || !data) return <PageLoader />
  const move = (stageId) => async (taskId) => {
    setData({ tasks: data.tasks.map((t) => (t.id === taskId ? { ...t, stageId } : t)) })
    try { await api.patch(`/projects/tasks/${taskId}`, { stageId }) } catch (err) { fail(err); reload() }
  }
  const add = async (e) => {
    e.preventDefault()
    try {
      await api.post(`/projects/${id}/tasks`, { name: adding.name, stageId: adding.stageId })
      setAdding(null)
      reload()
      reloadInfo()
    } catch (err) { fail(err) }
  }
  const addStage = async (e) => {
    e.preventDefault()
    try {
      await api.post(`/projects/${id}/stages`, { name: newStage })
      setNewStage('')
      reloadInfo()
    } catch (err) { fail(err) }
  }
  const tasks = data.tasks.filter((t) => !t.parentId)
  return (
    <>
      <div className="mb-3 mt-1 flex flex-wrap items-center justify-between gap-2">
        <div><Link to="/projects" className="link">Projects</Link><span className="text-ink-muted"> / </span><Link to={`/projects/${id}`} className="link">{info.project.name}</Link><h1 className="text-[22px] font-bold tracking-tight">{info.project.taskLabel}</h1></div>
      </div>
      <ProjectsNav />
      <div className="flex gap-3 overflow-x-auto pb-3">
        {info.taskStages.map((s) => {
          const list = tasks.filter((t) => t.stageId === s.id)
          return (
            <DropColumn key={s.id} title={s.name} count={list.length} onDrop={move(s.id)} action={<button aria-label={`Add to ${s.name}`} className="rounded p-0.5 hover:bg-card" onClick={() => setAdding({ stageId: s.id, name: '' })}><Plus size={14} /></button>}>
              {adding?.stageId === s.id && (
                <form onSubmit={add} className="rounded-xl border border-line bg-card p-2">
                  <input autoFocus required className="input" placeholder="Task title" aria-label="Task title" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
                  <div className="mt-2 flex gap-2"><button className="btn-primary btn-sm">Add</button><button type="button" className="btn-outline btn-sm" onClick={() => setAdding(null)}>Cancel</button></div>
                </form>
              )}
              {list.map((t) => <TaskCard key={t.id} t={t} onOpen={(tid) => setParams({ task: tid })} />)}
            </DropColumn>
          )
        })}
        {info.canEdit && (
          <form onSubmit={addStage} className="w-[220px] shrink-0 p-2"><input required className="input" placeholder="Add a stage" aria-label="Add a stage" value={newStage} onChange={(e) => setNewStage(e.target.value)} /></form>
        )}
      </div>
      {open && <TaskModal taskId={Number(open)} onClose={() => setParams({})} onChanged={() => { reload(); reloadInfo() }} />}
    </>
  )
}
