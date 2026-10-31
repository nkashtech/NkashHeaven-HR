import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Lock, Pencil, Play, Plus, Square, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useFetch, useInterval } from '../components/hooks'
import PersonPicker from '../components/PersonPicker'
import { Empty, Field, Modal, PageError, PageHeader, PageLoader, Segmented, StatusPill, Table } from '../components/ui'
import { addDays, clock, companyToday, fmtDay, fmtRange, hhmm, isoWeek, mondayOf } from '../utils/format'
import api, { errorMessage } from '../services/api'

// The Odoo line form: date, project, task, person assisted, description, time spent.
function usePickers() {
  const { data: projects, reload } = useFetch('/timesheets/projects')
  const { data: people } = useFetch('/timesheets/people')
  return { projects: projects?.projects || [], people: people?.people || [], reload }
}

function ProjectPicker({ form, setForm, projects, reload }) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const tasks = projects.find((p) => p.id === Number(form.projectId))?.tasks || []
  const create = async () => {
    try {
      const { data } = await api.post('/projects', { name })
      await reload()
      setForm({ ...form, projectId: data.project.id, taskId: '' })
      setCreating(false)
      setName('')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  return (
    <>
      <Field label="Project">
        {creating ? (
          <div className="flex gap-2">
            <input autoFocus className="input" placeholder="New project name" aria-label="New project name" value={name} onChange={(e) => setName(e.target.value)} />
            <button type="button" className="btn-primary" disabled={!name.trim()} onClick={create}>Create</button>
            <button type="button" className="btn-outline" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        ) : (
          <select required className="input" value={form.projectId} onChange={(e) => (e.target.value === 'new' ? setCreating(true) : setForm({ ...form, projectId: e.target.value, taskId: '' }))}>
            <option value="">Choose a project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="new">+ Create a new project</option>
          </select>
        )}
      </Field>
      <Field label="Task">
        <select className="input" value={form.taskId} onChange={(e) => setForm({ ...form, taskId: e.target.value })} disabled={!form.projectId}>
          <option value="">No task</option>
          {tasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
    </>
  )
}

function EntryModal({ entry, onClose, onSaved, defaultDate }) {
  const { projects, people, reload } = usePickers()
  const [form, setForm] = useState({
    date: entry?.date || defaultDate, projectId: entry?.projectId || '', taskId: entry?.taskId || '', assistedUserId: entry?.assisted?.id || '', description: entry?.description || '', hours: entry ? hhmm(entry.hours) : '',
  })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    try {
      if (entry) await api.patch(`/timesheets/entries/${entry.id}`, form)
      else await api.post('/timesheets/entries', form)
      onSaved()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  return (
    <Modal title={entry ? 'Edit entry' : 'New entry'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Date"><input type="date" required className="input" value={form.date} onChange={set('date')} /></Field>
        <ProjectPicker form={form} setForm={setForm} projects={projects} reload={reload} />
        <Field label="Worked with" hint="They get an in-app notification."><PersonPicker label="Worked with" people={people} value={form.assistedUserId} onChange={(v) => setForm({ ...form, assistedUserId: v })} /></Field>
        <Field label="Description"><textarea rows={2} className="input" placeholder="What did you work on?" value={form.description} onChange={set('description')} /></Field>
        <Field label="Time spent"><input required className="input" placeholder="1:30" value={form.hours} onChange={set('hours')} /></Field>
        <div className="flex justify-end gap-2"><button type="button" className="btn-outline" onClick={onClose}>Cancel</button><button className="btn-primary">Save</button></div>
      </form>
    </Modal>
  )
}

// The top START button: pick what you're working on, then the timer runs.
function StartTimer({ onClose, onStarted }) {
  const { projects, people, reload } = usePickers()
  const [form, setForm] = useState({ projectId: '', taskId: '', assistedUserId: '', description: '' })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    try {
      await api.post('/timesheets/timer/start', form)
      onStarted()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  return (
    <Modal title="Start the timer" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <ProjectPicker form={form} setForm={setForm} projects={projects} reload={reload} />
        <Field label="Worked with"><PersonPicker label="Worked with" people={people} value={form.assistedUserId} onChange={(v) => setForm({ ...form, assistedUserId: v })} /></Field>
        <Field label="Description"><input className="input" value={form.description} onChange={set('description')} /></Field>
        <button className="btn-primary w-full"><Play size={14} />Start</button>
      </form>
    </Modal>
  )
}

const STATE = { DRAFT: ['DRAFT', 'To validate'], PARTLY_VALIDATED: ['PARTLY_APPROVED', 'Partly validated'], VALIDATED: ['APPROVED', 'Validated'] }

// Saves on blur (UC-04 step 4).
function Cell({ row, day, week, locked, onSaved }) {
  const stored = row.cells[day.date]?.hours || 0
  const [value, setValue] = useState(hhmm(stored))
  useEffect(() => setValue(hhmm(stored)), [stored])
  const save = async () => {
    if (value === hhmm(stored)) return
    try {
      await api.put('/timesheets/cell', { date: day.date, projectId: row.projectId, taskId: row.taskId, hours: value })
      onSaved()
    } catch (err) {
      setValue(hhmm(stored))
      toast.error(errorMessage(err))
    }
  }
  const off = day.holiday || day.leave || !day.scheduled
  return (
    <td className={`px-1 py-1.5 text-center ${off ? 'bg-subtle' : day.date === week.today ? 'bg-brand-soft/60' : ''}`} title={day.holiday || day.leave || undefined}>
      <input
        aria-label={`${row.project} ${day.date} hours`} disabled={locked} value={value} onChange={(e) => setValue(e.target.value)} onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} onFocus={(e) => e.target.select()}
        className={`w-14 rounded-lg bg-transparent py-1 text-center text-[13px] font-semibold tabular-nums focus:bg-card focus:outline-none focus:ring-2 focus:ring-brand/30 ${stored ? 'text-ink' : 'text-ink-muted'} disabled:cursor-not-allowed`}
      />
    </td>
  )
}

function AddLine({ week, onClose, onSaved }) {
  const { projects, reload } = usePickers()
  const [form, setForm] = useState({ projectId: '', taskId: '' })
  const submit = async (e) => {
    e.preventDefault()
    try {
      await api.post('/timesheets/rows', { week, ...form })
      onSaved()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  return (
    <Modal title="Add a line" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <ProjectPicker form={form} setForm={setForm} projects={projects} reload={reload} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary">Add line</button>
        </div>
      </form>
    </Modal>
  )
}

function TimerButton({ row, timer, offset, onChange }) {
  const [, tick] = useState(0)
  const running = timer && timer.projectId === row.projectId && timer.taskId === row.taskId
  useInterval(() => tick((n) => n + 1), running ? 1000 : null)
  const start = async () => {
    try {
      const { data } = await api.post('/timesheets/timer/start', { projectId: row.projectId, taskId: row.taskId })
      if (data.stopped) toast(`Previous timer banked: ${hhmm(data.stopped.hours)}`)
      onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const stop = async () => {
    try {
      const { data } = await api.post('/timesheets/timer/stop')
      toast.success(`${hhmm(data.stopped.hours)} added to today`)
      onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  if (running) {
    return <button className="btn-danger btn-sm tabular-nums" onClick={stop}><Square size={12} />{clock((Date.now() + offset - new Date(timer.startedAt)) / 1000)}</button>
  }
  return <button className="btn-outline btn-sm" onClick={start}><Play size={12} />Start</button>
}

function Grid({ grid, week, reload, offset }) {
  const locked = grid.state !== 'DRAFT'
  const today = companyToday()
  // Odoo's shortcuts: a letter starts that row's timer, Shift + letter adds 15 minutes to today.
  useEffect(() => {
    if (locked) return undefined
    const onKey = async (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return
      const row = grid.rows[e.key.toLowerCase().charCodeAt(0) - 97]
      if (e.key.length !== 1 || !row) return
      try {
        if (e.shiftKey) {
          await api.put('/timesheets/cell', { date: today, projectId: row.projectId, taskId: row.taskId, hours: (row.cells[today]?.hours || 0) + 0.25 })
        } else if (grid.timer?.projectId === row.projectId && grid.timer?.taskId === row.taskId) {
          await api.post('/timesheets/timer/stop')
        } else {
          await api.post('/timesheets/timer/start', { projectId: row.projectId, taskId: row.taskId })
        }
        reload()
      } catch (err) {
        toast.error(errorMessage(err))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [grid, locked, reload, today])
  const removeRow = async (row) => {
    try {
      await api.delete('/timesheets/rows', { data: { week, projectId: row.projectId, taskId: row.taskId } })
      reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const auto = grid.days.find((d) => d.autoClosed)
  return (
    <>
      <Table>
        <thead className="bg-subtle">
          <tr>
            <th className="th">Project · Task</th>
            {grid.days.map((d) => (
              <th key={d.date} className={`th !px-1 !text-center normal-case ${d.date === today ? '!text-brand-ink' : ''}`} title={d.holiday || d.leave || undefined}>
                {fmtDay(d.date, 'EEE d')}{(d.holiday || d.leave) && <div className="truncate text-[10px] font-medium normal-case text-ink-muted">{d.holiday || d.leave}</div>}
              </th>
            ))}
            <th className="th !text-center">Total</th><th className="th !text-center">Timer</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {!grid.rows.length && <tr><td colSpan={10} className="td text-center text-ink-muted">No lines yet. Click Add a line to start this week.</td></tr>}
          {grid.rows.map((r, index) => (
            <tr key={r.key} className="group">
              <td className="td min-w-[170px]">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {index < 26 && !locked && <kbd className="hidden h-5 w-5 items-center justify-center rounded border border-line text-[10px] font-bold text-ink-muted sm:flex">{String.fromCharCode(97 + index)}</kbd>}
                    <div><div className="font-semibold">{r.project}</div>{r.task && <div className="text-xs text-ink-muted">{r.task}</div>}</div>
                  </div>
                  {!locked && <button className="invisible rounded p-1 text-ink-muted hover:text-bad group-hover:visible" onClick={() => removeRow(r)} aria-label={`Remove ${r.project}`}><Trash2 size={13} /></button>}
                </div>
              </td>
              {grid.days.map((d) => <Cell key={d.date} row={r} day={d} week={{ today }} locked={locked} onSaved={reload} />)}
              <td className="td text-center font-bold tabular-nums">{hhmm(r.total)}</td>
              <td className="td text-center">{locked ? <Lock size={14} className="mx-auto text-ink-muted" aria-label="Locked" /> : <TimerButton row={r} timer={grid.timer} offset={offset} onChange={reload} />}</td>
            </tr>
          ))}
          <tr className="bg-subtle font-bold">
            <td className="td">Total logged</td>
            {grid.days.map((d) => <td key={d.date} className="py-2 text-center text-[13px] tabular-nums">{hhmm(d.logged)}</td>)}
            <td className="td text-center text-brand-ink tabular-nums">{hhmm(grid.totalLogged)}</td><td />
          </tr>
          <tr>
            <td className="td text-ink-soft">Attendance (from check-in)</td>
            {grid.days.map((d) => (
              <td key={d.date} className={`py-2 text-center text-[13px] tabular-nums ${d.hasAttendance && Math.abs(d.attended - d.logged) > 1.5 ? 'text-warn' : 'text-ink-soft'}`}>
                {d.hasAttendance ? `${hhmm(d.attended)}${d.open ? '+' : ''}` : '—'}
              </td>
            ))}
            <td className="td text-center text-ink-soft tabular-nums">{hhmm(grid.totalAttended)}</td><td />
          </tr>
        </tbody>
      </Table>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <p className="rounded-xl bg-subtle px-4 py-3 text-xs text-ink-soft">Type hours as 3:30 or 3.5. Press a row's letter to start its timer, or Shift + the letter to add 15 minutes to today. Time rounds up to 15 minutes and only one timer runs at a time. Once the week is validated, the cells lock.</p>
        {auto && <p className="rounded-xl bg-warn-soft px-4 py-3 text-xs text-warn">{fmtDay(auto.date, 'EEEE')} shows {hhmm(auto.attended)} attended because the record was auto checked-out. Correct it under Attendance.</p>}
      </div>
    </>
  )
}

function ListView({ week, onChanged }) {
  const [state, setState] = useState('')
  const [groupBy, setGroupBy] = useState('none')
  const [editing, setEditing] = useState(null)
  const { data, error, reload } = useFetch(`/timesheets/lines?state=${state}`)
  const groups = useMemo(() => {
    if (!data) return []
    if (groupBy === 'none') return [{ key: 'all', rows: data.lines }]
    const map = new Map()
    data.lines.forEach((l) => {
      const key = groupBy === 'project' ? l.project : groupBy === 'task' ? `${l.project} · ${l.task || 'No task'}` : fmtDay(l.date, 'EEE d MMM yyyy')
      map.set(key, [...(map.get(key) || []), l])
    })
    return [...map.entries()].map(([key, rows]) => ({ key, rows }))
  }, [data, groupBy])
  if (error) return <PageError message={error} onRetry={reload} />
  if (!data) return <PageLoader />
  const saved = () => { setEditing(null); reload(); onChanged() }
  const remove = async (l) => {
    try {
      await api.delete(`/timesheets/entries/${l.id}`)
      saved()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button className="btn-primary" onClick={() => setEditing({})}><Plus size={14} />New entry</button>
        <select className="input !w-auto font-semibold" value={state} onChange={(e) => setState(e.target.value)} aria-label="Status">
          <option value="">All lines</option><option value="open">Not validated</option><option value="validated">Validated</option>
        </select>
        <select className="input !w-auto font-semibold" value={groupBy} onChange={(e) => setGroupBy(e.target.value)} aria-label="Group by">
          <option value="none">No grouping</option><option value="project">Group by: Project</option><option value="task">Group by: Task</option><option value="date">Group by: Date</option>
        </select>
        <span className="ml-auto text-[13px] text-ink-soft">Total <b className="text-ink">{hhmm(data.total)}</b></span>
      </div>
      <Table>
        <thead className="bg-subtle"><tr><th className="th">Date</th><th className="th">Project</th><th className="th">Task</th><th className="th">Worked with</th><th className="th">Description</th><th className="th text-right">Time spent</th><th className="th">State</th><th className="th" /></tr></thead>
        <tbody className="divide-y divide-line">
          {!data.lines.length && <tr><td colSpan={8}><Empty>No lines match.</Empty></td></tr>}
          {groups.map((g) => [
            groupBy !== 'none' && <tr key={g.key} className="bg-subtle/60"><td colSpan={5} className="px-4 py-1.5 text-xs font-bold">{g.key}</td><td className="px-4 text-right text-xs font-bold">{hhmm(g.rows.reduce((s, l) => s + l.hours, 0))}</td><td colSpan={2} /></tr>,
            ...g.rows.map((l) => (
              <tr key={l.id}>
                <td className="td whitespace-nowrap">{fmtDay(l.date)}</td><td className="td">{l.project}</td><td className="td">{l.task || '—'}</td><td className="td">{l.assisted?.name || '—'}</td><td className="td text-ink-soft">{l.description || '—'}</td>
                <td className="td text-right font-semibold tabular-nums">{hhmm(l.hours)}</td>
                <td className="td"><StatusPill status={STATE[l.state][0]}>{STATE[l.state][1]}</StatusPill></td>
                <td className="td whitespace-nowrap text-right">
                  {l.state === 'DRAFT' ? (
                    <span className="inline-flex gap-1"><button className="btn-outline btn-sm" aria-label="Edit entry" onClick={() => setEditing(l)}><Pencil size={12} /></button><button className="btn-outline btn-sm" aria-label="Delete entry" onClick={() => remove(l)}><Trash2 size={12} /></button></span>
                  ) : <Lock size={13} className="ml-auto text-ink-muted" aria-label="Locked" />}
                </td>
              </tr>
            )),
          ])}
        </tbody>
      </Table>
      {editing && <EntryModal entry={editing.id ? editing : null} defaultDate={companyToday() >= week && companyToday() <= addDays(week, 6) ? companyToday() : week} onClose={() => setEditing(null)} onSaved={saved} />}
    </>
  )
}

export default function Timesheets() {
  const [week, setWeek] = useState(mondayOf(companyToday()))
  const [view, setView] = useState('grid')
  const [adding, setAdding] = useState(false)
  const [starting, setStarting] = useState(false)
  const [offset, setOffset] = useState(0)
  const { data: grid, error, reload } = useFetch(`/timesheets/grid?week=${week}`)
  useEffect(() => { if (grid) setOffset(new Date(grid.serverNow).getTime() - Date.now()) }, [grid])
  if (error) return <PageError message={error} onRetry={reload} />
  if (!grid) return <PageLoader />
  const [tone, label] = STATE[grid.state]
  return (
    <>
      <PageHeader title="My Timesheets" subtitle={<>Week {isoWeek(week)} · {fmtRange(week, addDays(week, 6))} · <StatusPill status={tone}>{label}</StatusPill></>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button className="btn-outline !p-2" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week"><ChevronLeft size={16} /></button>
        <button className="btn-outline" onClick={() => setWeek(mondayOf(companyToday()))}>Today</button>
        <button className="btn-outline !p-2" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week"><ChevronRight size={16} /></button>
        {grid.timer ? (
          <button className="btn-danger" onClick={() => api.post('/timesheets/timer/stop').then(({ data }) => { toast.success(`${hhmm(data.stopped.hours)} logged`); reload() }).catch((e) => toast.error(errorMessage(e)))}><Square size={13} />Stop · {grid.timer.project}{grid.timer.task ? ` · ${grid.timer.task}` : ''}</button>
        ) : <button className="btn-primary" onClick={() => setStarting(true)}><Play size={13} />START</button>}
        <div className="ml-auto flex gap-2">
          <Segmented value={view} onChange={setView} options={[['grid', 'Grid'], ['list', 'Entries']]} />
          {view === 'grid' && <button className="btn-primary" disabled={grid.state !== 'DRAFT'} onClick={() => setAdding(true)}><Plus size={14} />Add a line</button>}
        </div>
      </div>
      {view === 'grid' ? <Grid grid={grid} week={week} reload={reload} offset={offset} /> : <ListView week={week} onChanged={reload} />}
      {adding && <AddLine week={week} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload() }} />}
      {starting && <StartTimer onClose={() => setStarting(false)} onStarted={() => { setStarting(false); reload() }} />}
    </>
  )
}
