import { useEffect, useState } from 'react'
import { Plus, Star, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../contexts/AuthContext'
import { useFetch } from '../components/hooks'
import { Bar, Card, Empty, Field, Modal, PageError, PageHeader, PageLoader, Pill, Segmented, Table } from '../components/ui'
import { addDays, companyToday, fmtDay } from '../utils/format'
import api, { errorMessage } from '../services/api'

const fail = (err) => toast.error(errorMessage(err))
const STATE = { NEW: ['neutral', 'New'], PENDING: ['warn', 'Waiting for feedback'], DONE: ['ok', 'Done'], CANCELLED: ['bad', 'Cancelled'] }

function Rating({ value, onChange }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => <button type="button" key={n} aria-label={`${n} stars`} disabled={!onChange} onClick={() => onChange?.(n)} className={n <= (value || 0) ? 'text-warn' : 'text-ink-muted'}><Star size={20} fill={n <= (value || 0) ? 'currentColor' : 'none'} /></button>)}
    </div>
  )
}

function AppraisalForm({ item, onClose, onChanged }) {
  const { isAdmin } = useAuth()
  const [employee, setEmployee] = useState(item.employeeFeedback || '')
  const [manager, setManager] = useState(item.managerFeedback || '')
  const [rating, setRating] = useState(item.rating || 0)
  const open = item.state === 'PENDING'
  const canFinish = (item.isManager || isAdmin) && open && !item.isEmployee
  const save = async (submit) => {
    try {
      await api.patch(`/appraisals/${item.id}`, item.isEmployee ? { employeeFeedback: employee } : { managerFeedback: manager })
      if (submit) await api.post(`/appraisals/${item.id}/submit`)
      toast.success(submit ? 'Submitted' : 'Saved')
      onChanged()
    } catch (err) { fail(err) }
  }
  const finish = async () => {
    try {
      if (item.isManager) await api.patch(`/appraisals/${item.id}`, { managerFeedback: manager })
      await api.post(`/appraisals/${item.id}/finish`, { rating })
      onChanged()
    } catch (err) { fail(err) }
  }
  const run = (step) => api.post(`/appraisals/${item.id}/${step}`).then(onChanged).catch(fail)
  const hiddenManager = !item.isManager && item.state !== 'DONE'
  const hiddenEmployee = item.employeeFeedback === null
  return (
    <Modal title={`${item.userName}'s appraisal`} wide onClose={onClose}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]"><Pill tone={STATE[item.state][0]}>{STATE[item.state][1]}</Pill><span className="text-ink-soft">Manager: {item.managerName} · due {fmtDay(item.deadline, 'd MMM yyyy')}</span></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[13px] font-bold">Employee's feedback {item.employeeDone && <Pill tone="ok">Submitted</Pill>}</div>
          {hiddenEmployee ? <p className="rounded-lg bg-subtle p-3 text-[13px] text-ink-muted">Visible once {item.userName.split(' ')[0]} submits.</p>
            : <textarea rows={10} aria-label="Employee's feedback" className="input" disabled={!item.isEmployee || !open || item.employeeDone} value={employee} onChange={(e) => setEmployee(e.target.value)} />}
        </div>
        <div>
          <div className="mb-1 flex items-center gap-2 text-[13px] font-bold">Manager's feedback {item.managerDone && <Pill tone="ok">Submitted</Pill>}</div>
          {hiddenManager ? <p className="rounded-lg bg-subtle p-3 text-[13px] text-ink-muted">Visible when the appraisal is finished.</p>
            : <textarea rows={10} aria-label="Manager's feedback" className="input" disabled={!item.isManager || !open} value={manager} onChange={(e) => setManager(e.target.value)} />}
        </div>
      </div>
      {(canFinish || item.state === 'DONE') && <div className="mt-3"><div className="label">Final rating</div><Rating value={rating} onChange={canFinish ? setRating : null} /></div>}
      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-line pt-3">
        {item.isEmployee && open && !item.employeeDone && <><button className="btn-outline" onClick={() => save(false)}>Save draft</button><button className="btn-primary" onClick={() => save(true)}>Submit my feedback</button></>}
        {item.isManager && open && <button className="btn-outline" onClick={() => save(false)}>Save</button>}
        {canFinish && <button className="btn-primary" disabled={!rating} onClick={finish}>Finish appraisal</button>}
        {(item.isManager || isAdmin) && open && <button className="btn-ghost" onClick={() => run('cancel')}>Cancel appraisal</button>}
        {(item.isManager || isAdmin) && item.state === 'DONE' && <button className="btn-outline" onClick={() => run('reopen')}>Reopen</button>}
      </div>
    </Modal>
  )
}

function NewAppraisal({ onClose, onSaved }) {
  const { data } = useFetch('/people/directory')
  const { user } = useAuth()
  const [form, setForm] = useState({ userId: '', deadline: addDays(companyToday(), 21) })
  const submit = async (e) => {
    e.preventDefault()
    try {
      await api.post('/appraisals', form)
      onSaved()
    } catch (err) { fail(err) }
  }
  return (
    <Modal title="Start an appraisal" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Employee"><select required className="input" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}><option value="">Choose</option>{data?.people.filter((p) => p.id !== user.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Deadline"><input type="date" required className="input" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></Field>
        <button className="btn-primary w-full">Start</button>
      </form>
    </Modal>
  )
}

function Goals({ userId }) {
  const { data, reload } = useFetch(`/appraisals/goals${userId ? `?userId=${userId}` : ''}`)
  const [title, setTitle] = useState('')
  const add = async (e) => {
    e.preventDefault()
    try {
      await api.post('/appraisals/goals', { title, userId })
      setTitle('')
      reload()
    } catch (err) { fail(err) }
  }
  const progress = (g, value) => api.patch(`/appraisals/goals/${g.id}`, { progress: value }).then(reload).catch(fail)
  return (
    <Card title="Goals">
      <form onSubmit={add} className="mb-3 flex gap-2"><input required className="input" placeholder="Add a goal" aria-label="Add a goal" value={title} onChange={(e) => setTitle(e.target.value)} /><button className="btn-outline"><Plus size={14} />Add</button></form>
      {!data?.goals.length && <Empty>No goals yet.</Empty>}
      {data?.goals.map((g) => (
        <div key={g.id} className="mb-3">
          <div className="mb-1 flex items-center justify-between gap-2 text-[13px]"><span className="font-medium">{g.title}</span><span className="flex items-center gap-2"><b>{g.progress}%</b><button aria-label={`Remove ${g.title}`} className="text-ink-muted hover:text-bad" onClick={() => api.delete(`/appraisals/goals/${g.id}`).then(reload).catch(fail)}><Trash2 size={12} /></button></span></div>
          <Bar value={g.progress} max={100} color="rgb(var(--teal))" />
          <input type="range" min="0" max="100" step="5" aria-label={`Progress of ${g.title}`} className="mt-1 w-full accent-brand" defaultValue={g.progress} onMouseUp={(e) => progress(g, Number(e.target.value))} onTouchEnd={(e) => progress(g, Number(e.target.value))} />
        </div>
      ))}
    </Card>
  )
}

export default function Appraisals() {
  const [scope, setScope] = useState('all')
  const { data, error, reload } = useFetch(`/appraisals${scope === 'mine' ? '?scope=mine' : ''}`)
  const [open, setOpen] = useState(null)
  const [creating, setCreating] = useState(false)
  useEffect(() => { if (open && data) setOpen(data.appraisals.find((a) => a.id === open.id) || null) }, [data]) // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <PageError message={error} onRetry={reload} />
  if (!data) return <PageLoader />
  return (
    <>
      <PageHeader title="Appraisals" subtitle="Feedback stays private to each side until the appraisal is finished">
        <Segmented value={scope} onChange={setScope} options={[['all', 'All I can see'], ['mine', 'Mine']]} />
        {data.canCreate && <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={14} />New</button>}
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Table className="self-start">
          <thead className="bg-subtle"><tr><th className="th">Employee</th><th className="th">Manager</th><th className="th">Deadline</th><th className="th">Status</th><th className="th">Rating</th></tr></thead>
          <tbody className="divide-y divide-line">
            {!data.appraisals.length && <tr><td colSpan={5} className="td text-center text-ink-muted">No appraisals.</td></tr>}
            {data.appraisals.map((a) => (
              <tr key={a.id} className="cursor-pointer hover:bg-subtle/50" onClick={() => setOpen(a)}>
                <td className="td font-semibold">{a.userName}</td><td className="td">{a.managerName}</td><td className="td whitespace-nowrap">{fmtDay(a.deadline, 'd MMM yyyy')}</td>
                <td className="td"><Pill tone={STATE[a.state][0]}>{STATE[a.state][1]}</Pill></td><td className="td">{a.rating ? `${a.rating} / 5` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Goals />
      </div>
      {open && <AppraisalForm item={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); reload() }} />}
      {creating && <NewAppraisal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />}
    </>
  )
}
