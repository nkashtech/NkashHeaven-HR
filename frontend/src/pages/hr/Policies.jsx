import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useFetch } from '../../components/hooks'
import { Card, Empty, Field, Modal, PageHeader, PageLoader, Pill, Table, Toggle } from '../../components/ui'
import { companyToday, fmtDay } from '../../utils/format'
import { applyBrand, useAuth } from '../../contexts/AuthContext'
import { clearBranding } from '../../components/Layout'
import CardView from '../cards/CardView'
import api, { download, errorMessage, uploadFile } from '../../services/api'

const fail = (err) => toast.error(errorMessage(err))
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

function Attendance() {
  const { data, reload } = useFetch('/settings/company')
  const [form, setForm] = useState(null)
  useEffect(() => { if (data) setForm({ companyName: data.companyName, timezone: data.timezone, lockDate: data.lockDate, graceMinutes: data.attendance.graceMinutes, autoCheckoutHours: data.attendance.autoCheckoutHours, roundingMinutes: data.timesheets.roundingMinutes }) }, [data])
  if (!form) return <PageLoader />
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const save = async (e) => {
    e.preventDefault()
    try {
      await api.put('/settings/company', {
        companyName: form.companyName, timezone: form.timezone,
        attendance: { lockDate: form.lockDate, graceMinutes: Number(form.graceMinutes), autoCheckoutHours: Number(form.autoCheckoutHours) },
        timesheets: { roundingMinutes: Number(form.roundingMinutes) },
      })
      toast.success('Saved')
      reload()
    } catch (err) { fail(err) }
  }
  return (
    <Card title="Company and attendance rules">
      <form onSubmit={save} className="grid max-w-2xl gap-3 sm:grid-cols-2">
        <Field label="Company name"><input className="input" value={form.companyName} onChange={set('companyName')} /></Field>
        <Field label="Company timezone"><input className="input" value={form.timezone} onChange={set('timezone')} /></Field>
        <Field label="Attendance lock date" hint="Staff can't edit anything before this date. HR can."><input type="date" className="input" value={form.lockDate} onChange={set('lockDate')} /></Field>
        <Field label="Late grace period (minutes)"><input type="number" min="0" className="input" value={form.graceMinutes} onChange={set('graceMinutes')} /></Field>
        <Field label="Auto check-out after schedule end (hours)"><input type="number" min="1" className="input" value={form.autoCheckoutHours} onChange={set('autoCheckoutHours')} /></Field>
        <Field label="Timesheet timer rounding (minutes)"><input type="number" min="1" className="input" value={form.roundingMinutes} onChange={set('roundingMinutes')} /></Field>
        <div className="sm:col-span-2"><button className="btn-primary">Save rules</button></div>
      </form>
    </Card>
  )
}

const BLANK_TYPE = { name: '', colour: '#E2744A', requiresAllocation: true, approvalSteps: 'MANAGER_HR', attachmentAfterDays: '', halfDayAllowed: true, accrualPerMonth: '', defaultDays: '', maxCarryOver: '', carryExpiry: '' }
const STEPS = { MANAGER_HR: 'Manager, then HR', HR: 'Straight to HR', MANAGER: 'Manager only', NONE: 'No approval' }

function TypeModal({ type, onClose, onSaved }) {
  const { data: wf } = useFetch('/settings/workflows')
  const workflows = wf?.workflows || []
  const [form, setForm] = useState({ ...BLANK_TYPE, ...type, attachmentAfterDays: type?.attachmentAfterDays ?? '', accrualPerMonth: type?.accrualPerMonth ?? '', defaultDays: type?.defaultDays ?? '', maxCarryOver: type?.maxCarryOver ?? '', carryExpiry: type?.carryExpiry ?? '' })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    const num = (v) => (v === '' ? '' : Number(v))
    const body = { ...form, attachmentAfterDays: num(form.attachmentAfterDays), accrualPerMonth: num(form.accrualPerMonth), defaultDays: num(form.defaultDays), maxCarryOver: num(form.maxCarryOver) }
    delete body.id
    delete body.companyId
    body.workflowId = form.workflowId || null
    try {
      if (type?.id) await api.patch(`/leave/types/${type.id}`, body)
      else await api.post('/leave/types', body)
      onSaved()
    } catch (err) { fail(err) }
  }
  return (
    <Modal title={type?.id ? `Edit ${type.name}` : 'New leave type'} wide onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><input required className="input" value={form.name} onChange={set('name')} /></Field>
        <Field label="Colour"><input type="color" className="input !h-[38px] !p-1" value={form.colour} onChange={set('colour')} /></Field>
        <Field label="Approval flow"><select className="input" value={form.approvalSteps} onChange={set('approvalSteps')}>{Object.entries(STEPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Or use a workflow" hint="Replaces the approval flow"><select className="input" value={form.workflowId || ''} onChange={set('workflowId')}><option value="">None</option>{workflows.filter((w) => w.appliesTo === 'LEAVE').map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        <Field label="Document needed after (days)" hint="Empty means never"><input type="number" min="0" className="input" value={form.attachmentAfterDays} onChange={set('attachmentAfterDays')} /></Field>
        <Field label="Days granted at start" hint="For a fixed yearly allocation"><input type="number" step="0.5" min="0" className="input" value={form.defaultDays} onChange={set('defaultDays')} /></Field>
        <Field label="Accrual per month" hint="e.g. 1.25 for 15 days a year"><input type="number" step="0.01" min="0" className="input" value={form.accrualPerMonth} onChange={set('accrualPerMonth')} /></Field>
        <Field label="Max carry-over days"><input type="number" step="0.5" min="0" className="input" value={form.maxCarryOver} onChange={set('maxCarryOver')} /></Field>
        <Field label="Carry-over expires (MM-DD)"><input className="input" pattern="\d{2}-\d{2}" placeholder="06-30" value={form.carryExpiry} onChange={set('carryExpiry')} /></Field>
        <div className="flex items-center justify-between rounded-xl bg-subtle px-3 py-2 text-[13px]">Requires allocation<Toggle label="Requires allocation" checked={form.requiresAllocation} onChange={(v) => setForm({ ...form, requiresAllocation: v })} /></div>
        <div className="flex items-center justify-between rounded-xl bg-subtle px-3 py-2 text-[13px]">Allow half days<Toggle label="Allow half days" checked={form.halfDayAllowed} onChange={(v) => setForm({ ...form, halfDayAllowed: v })} /></div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary">Save</button>
        </div>
      </form>
    </Modal>
  )
}

function AllocationModal({ types, onClose }) {
  const year = companyToday().slice(0, 4)
  const { data: depts } = useFetch('/settings/departments')
  const [form, setForm] = useState({ leaveTypeId: types[0]?.id, days: '', scope: 'everyone', departmentId: '', periodStart: `${year}-01-01`, periodEnd: `${year}-12-31`, note: '' })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    try {
      const { data } = await api.post('/leave/allocations', { ...form, everyone: form.scope === 'everyone', departmentId: form.scope === 'dept' ? form.departmentId : undefined })
      toast.success(`Granted to ${data.created} people`)
      onClose()
    } catch (err) { fail(err) }
  }
  return (
    <Modal title="Grant an allocation" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Leave type"><select className="input" value={form.leaveTypeId} onChange={set('leaveTypeId')}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        <Field label="Days"><input type="number" step="0.5" required className="input" value={form.days} onChange={set('days')} /></Field>
        <Field label="Who"><select className="input" value={form.scope} onChange={set('scope')}><option value="everyone">Everyone</option><option value="dept">A department</option></select></Field>
        {form.scope === 'dept' && <Field label="Department"><select required className="input" value={form.departmentId} onChange={set('departmentId')}><option value="">Choose</option>{depts?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><input type="date" required className="input" value={form.periodStart} onChange={set('periodStart')} /></Field>
          <Field label="To"><input type="date" required className="input" value={form.periodEnd} onChange={set('periodEnd')} /></Field>
        </div>
        <Field label="Note"><input className="input" value={form.note} onChange={set('note')} /></Field>
        <button className="btn-primary w-full">Grant</button>
      </form>
    </Modal>
  )
}

function LeaveTypes() {
  const { data, reload } = useFetch('/leave/types?all=1')
  const [editing, setEditing] = useState(null)
  const [granting, setGranting] = useState(false)
  if (!data) return <PageLoader />
  return (
    <Card title="Leave types" action={<div className="flex gap-2"><button className="btn-outline" onClick={() => setGranting(true)}>Grant allocation</button><button className="btn-primary" onClick={() => setEditing({})}><Plus size={14} />New type</button></div>}>
      <Table>
        <thead className="bg-subtle"><tr><th className="th">Type</th><th className="th">Approval</th><th className="th">Allocation</th><th className="th">Document</th><th className="th">Half days</th><th className="th" /></tr></thead>
        <tbody className="divide-y divide-line">
          {data.types.map((t) => (
            <tr key={t.id}>
              <td className="td"><span className="flex items-center gap-2 font-semibold"><span className="h-3 w-3 rounded-full" style={{ background: t.colour }} />{t.name}{!t.active && <Pill>Inactive</Pill>}</span></td>
              <td className="td">{STEPS[t.approvalSteps]}</td>
              <td className="td">{!t.requiresAllocation ? 'None needed' : t.accrualPerMonth ? `${t.accrualPerMonth} per month` : `${t.defaultDays || 0} days`}</td>
              <td className="td">{t.attachmentAfterDays === null ? 'Never' : `After ${t.attachmentAfterDays} days`}</td>
              <td className="td">{t.halfDayAllowed ? 'Yes' : 'No'}</td>
              <td className="td text-right"><button className="btn-outline btn-sm" onClick={() => setEditing(t)}>Edit</button></td>
            </tr>
          ))}
        </tbody>
      </Table>
      {editing && <TypeModal type={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {granting && <AllocationModal types={data.types.filter((t) => t.requiresAllocation)} onClose={() => setGranting(false)} />}
    </Card>
  )
}

function Holidays() {
  const { data, reload } = useFetch('/settings/holidays')
  const blank = { date: '', name: '', kind: 'OFFICE' }
  const [form, setForm] = useState(blank)
  if (!data) return <PageLoader />
  const add = async (e) => {
    e.preventDefault()
    try {
      await api.post('/settings/holidays', form)
      setForm(blank)
      reload()
    } catch (err) { fail(err) }
  }
  const today = companyToday()
  return (
    <Card title="Public holidays">
      <form onSubmit={add} className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="Date"><input type="date" required className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
        <Field label="Name"><input required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Type"><select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="OFFICE">Office closure</option><option value="PUBLIC">Public holiday</option></select></Field>
        <button className="btn-primary">Add</button>
      </form>
      <p className="mb-2 text-xs text-ink-muted">Both types are non-working days: leave doesn't count them, and nobody is marked absent.</p>
      <div className="grid gap-x-6 sm:grid-cols-2">
        {data.holidays.filter((h) => h.date >= today).map((h) => (
          <div key={h.id} className="flex items-center justify-between border-b border-line py-1.5 text-[13px]">
            <span>{h.name} {h.kind === 'OFFICE' && <Pill tone="brand">Office</Pill>}</span>
            <span className="flex items-center gap-2 text-ink-soft">{fmtDay(h.date, 'EEE d MMM yyyy')}<button aria-label={`Remove ${h.name}`} className="text-ink-muted hover:text-bad" onClick={() => api.delete(`/settings/holidays/${h.id}`).then(reload).catch(fail)}><Trash2 size={13} /></button></span>
          </div>
        ))}
      </div>
    </Card>
  )
}

function ScheduleModal({ schedule, onClose, onSaved }) {
  const blank = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => [d, { start: '08:00', end: '17:00' }]))
  const [form, setForm] = useState({ name: schedule?.name || '', breakMinutes: schedule?.breakMinutes ?? 60, hoursPerDay: schedule?.hoursPerDay ?? 8, days: schedule?.days || blank })
  const setDay = (d, patch) => setForm({ ...form, days: { ...form.days, [d]: patch && { ...(form.days[d] || { start: '08:00', end: '17:00' }), ...patch } } })
  const submit = async (e) => {
    e.preventDefault()
    try {
      if (schedule?.id) await api.patch(`/settings/schedules/${schedule.id}`, form)
      else await api.post('/settings/schedules', form)
      onSaved()
    } catch (err) { fail(err) }
  }
  return (
    <Modal title={schedule?.id ? 'Edit schedule' : 'New work schedule'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name"><input required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Break (minutes)"><input type="number" className="input" value={form.breakMinutes} onChange={(e) => setForm({ ...form, breakMinutes: e.target.value })} /></Field>
          <Field label="Hours per day"><input type="number" step="0.25" className="input" value={form.hoursPerDay} onChange={(e) => setForm({ ...form, hoursPerDay: e.target.value })} /></Field>
        </div>
        {WEEK.map((d) => {
          const shift = form.days[d]
          return (
            <div key={d} className="flex items-center gap-2 text-[13px]">
              <span className="w-10 font-semibold capitalize">{d}</span>
              <Toggle label={`Works ${d}`} checked={Boolean(shift)} onChange={(v) => setDay(d, v ? {} : null)} />
              {shift ? (
                <>
                  <input aria-label={`${d} start`} type="time" className="input !w-auto" value={shift.start} onChange={(e) => setDay(d, { start: e.target.value })} />
                  <input aria-label={`${d} end`} type="time" className="input !w-auto" value={shift.end} onChange={(e) => setDay(d, { end: e.target.value })} />
                </>
              ) : <span className="text-ink-muted">Day off</span>}
            </div>
          )
        })}
        <button className="btn-primary w-full">Save</button>
      </form>
    </Modal>
  )
}

function Organisation() {
  const { data: schedules, reload: reloadSchedules } = useFetch('/settings/schedules')
  const { data: depts, reload: reloadDepts } = useFetch('/settings/departments')
  const { data: options } = useFetch('/employees/options')
  const { data: projects, reload: reloadProjects } = useFetch('/timesheets/projects/manage')
  const [editing, setEditing] = useState(null)
  const [newDept, setNewDept] = useState('')
  const [newProject, setNewProject] = useState('')
  const [newTask, setNewTask] = useState({})
  const addDept = async (e) => {
    e.preventDefault()
    try {
      await api.post('/settings/departments', { name: newDept })
      setNewDept('')
      reloadDepts()
    } catch (err) { fail(err) }
  }
  const addProject = async (e) => {
    e.preventDefault()
    try {
      await api.post('/timesheets/projects', { name: newProject })
      setNewProject('')
      reloadProjects()
    } catch (err) { fail(err) }
  }
  const addTask = async (e, id) => {
    e.preventDefault()
    try {
      await api.post(`/timesheets/projects/${id}/tasks`, { name: newTask[id] })
      setNewTask({ ...newTask, [id]: '' })
      reloadProjects()
    } catch (err) { fail(err) }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Departments">
        <form onSubmit={addDept} className="mb-2 flex gap-2"><input required className="input" placeholder="New department" aria-label="New department" value={newDept} onChange={(e) => setNewDept(e.target.value)} /><button className="btn-primary">Add</button></form>
        <div className="divide-y divide-line">
          {depts?.departments.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
              <span><b>{d.name}</b> <span className="text-ink-muted">· {d.people} people</span></span>
              <select className="input !w-44 !py-1" aria-label={`${d.name} manager`} value={d.manager?.id || ''} onChange={(e) => api.patch(`/settings/departments/${d.id}`, { managerId: e.target.value || null }).then(reloadDepts).catch(fail)}>
                <option value="">No manager</option>{options?.managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Work schedules" action={<button className="btn-primary" onClick={() => setEditing({})}><Plus size={14} />New</button>}>
        <div className="divide-y divide-line">
          {schedules?.schedules.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
              <span><b>{s.name}</b> <span className="text-ink-muted">· {s.hoursPerDay}h a day · {s.breakMinutes} min break · {s._count.users} people</span></span>
              <button className="btn-outline btn-sm" onClick={() => setEditing(s)}>Edit</button>
            </div>
          ))}
        </div>
      </Card>
      <Teams />
      <Card title="Projects and tasks" className="lg:col-span-2">
        <form onSubmit={addProject} className="mb-2 flex max-w-md gap-2"><input required className="input" placeholder="New project" aria-label="New project" value={newProject} onChange={(e) => setNewProject(e.target.value)} /><button className="btn-primary">Add</button></form>
        {!projects?.projects.length && <Empty>No projects yet.</Empty>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects?.projects.map((p) => (
            <div key={p.id} className="rounded-xl border border-line p-3 text-[13px]">
              <div className="flex items-center justify-between gap-2">
                <b className="truncate">{p.name}</b>
                <Toggle label={`${p.name} active`} checked={p.active} onChange={(v) => api.patch(`/timesheets/projects/${p.id}`, { active: v }).then(reloadProjects).catch(fail)} />
              </div>
              <div className="text-xs text-ink-muted">{p.department?.name || 'All departments'}</div>
              <div className="mt-1 text-xs text-ink-soft">{p.tasks.map((t) => t.name).join(', ')}</div>
              <form onSubmit={(e) => addTask(e, p.id)} className="mt-2 flex gap-1.5"><input required className="input !py-1" placeholder="Add a task" aria-label={`Add a task to ${p.name}`} value={newTask[p.id] || ''} onChange={(e) => setNewTask({ ...newTask, [p.id]: e.target.value })} /><button className="btn-outline btn-sm">Add</button></form>
            </div>
          ))}
        </div>
      </Card>
      {editing && <ScheduleModal schedule={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reloadSchedules() }} />}
    </div>
  )
}

function ImageField({ label, fileId, onChange }) {
  const pick = async (e) => {
    if (!e.target.files[0]) return
    try {
      const f = await uploadFile(e.target.files[0], 'branding')
      onChange(f.id)
    } catch (err) { fail(err) }
  }
  return (
    <Field label={label}>
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-32 items-center justify-center rounded-lg border border-line bg-white">{fileId ? <AuthImage id={fileId} /> : <span className="text-xs text-ink-muted">No image</span>}</div>
        <label className="btn-outline cursor-pointer">Upload<input type="file" accept="image/png,image/jpeg" className="hidden" onChange={pick} /></label>
        {fileId && <button type="button" className="btn-ghost btn-sm" onClick={() => onChange(null)}>Remove</button>}
      </div>
    </Field>
  )
}

function AuthImage({ id }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let url
    api.get(`/files/${id}`, { responseType: 'blob' }).then((r) => { url = URL.createObjectURL(r.data); setSrc(url) }).catch(() => {})
    return () => url && URL.revokeObjectURL(url)
  }, [id])
  return src ? <img src={src} alt="Logo preview" className="max-h-12 max-w-[7rem] object-contain" /> : null
}

function Branding() {
  const { refresh } = useAuth()
  const { data, reload } = useFetch('/settings/branding')
  const [form, setForm] = useState(null)
  useEffect(() => { if (data) setForm({ ...data.branding, companyName: data.companyName }) }, [data])
  if (!form) return <PageLoader />
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const save = async (e) => {
    e.preventDefault()
    try {
      await api.put('/settings/branding', form)
      toast.success('Saved')
      clearBranding()
      await refresh()
      reload()
    } catch (err) { fail(err) }
  }
  return (
    <Card title="Company branding">
      <form onSubmit={save} className="grid max-w-3xl gap-4 sm:grid-cols-2">
        <p className="rounded-xl bg-subtle px-3 py-2 text-xs text-ink-soft sm:col-span-2">The brand colour replaces the orange across the whole app, for everyone in your company, in light and dark mode. Your sign-in page uses it too.</p>
        <div className="sm:col-span-2"><Field label="Company name" hint="Shown in the app, on emails and on payslips"><input required className="input" value={form.companyName} onChange={set('companyName')} /></Field></div>
        <ImageField label="Company logo (app and emails)" fileId={form.logoFileId} onChange={(v) => setForm({ ...form, logoFileId: v })} />
        <ImageField label="Payslip logo (optional)" fileId={form.payslipLogoFileId} onChange={(v) => setForm({ ...form, payslipLogoFileId: v })} />
        <Field label="Brand colour"><input type="color" className="input !h-[38px] !p-1" value={form.primaryColor} onChange={(e) => { setForm({ ...form, primaryColor: e.target.value }); applyBrand(e.target.value) }} /></Field>
        <Field label="Registration number"><input className="input" value={form.registrationNo} onChange={set('registrationNo')} /></Field>
        <Field label="Address on payslips and emails"><input className="input" value={form.address} onChange={set('address')} /></Field>
        <Field label="Email footer"><input className="input" value={form.emailFooter} onChange={set('emailFooter')} /></Field>
        <p className="text-xs text-ink-muted sm:col-span-2">Use PNG or JPEG so logos print on payslips. Emails can only show the logo once the app has a public address.</p>
        <div><button className="btn-primary">Save branding</button></div>
      </form>
    </Card>
  )
}

function EmailTemplates() {
  const { data, reload } = useFetch('/settings/email-templates')
  const [key, setKey] = useState('welcome')
  const [form, setForm] = useState(null)
  const current = data?.templates.find((t) => t.key === key)
  useEffect(() => { if (current) setForm({ subject: current.subject, body: current.body, design: current.design || {} }) }, [current])
  if (!form || !current) return <PageLoader />
  const setD = (k, v) => setForm({ ...form, design: { ...form.design, [k]: v } })
  const save = async (e) => {
    e?.preventDefault()
    try {
      await api.put(`/settings/email-templates/${key}`, form)
      toast.success('Template saved')
      reload()
    } catch (err) { fail(err) }
  }
  const color = (k, label, fallback) => <Field label={label}><input type="color" className="input !h-[38px] !p-1" value={form.design[k] || fallback} onChange={(e) => setD(k, e.target.value)} /></Field>
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <Card title="Email templates">
        <form onSubmit={save} className="space-y-3">
          <Field label="Template"><select className="input" value={key} onChange={(e) => setKey(e.target.value)}>{data.templates.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></Field>
          <Field label="Subject"><input required className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
          <Field label="Heading"><input className="input" placeholder="Uses the default" value={form.design.heading || ''} onChange={(e) => setD('heading', e.target.value)} /></Field>
          <Field label="Text" hint={`You can use ${current.placeholders.map((p) => `{{${p}}}`).join(', ')}. Sign-in details and links are always added.`}><textarea rows={4} className="input" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
          <Field label="Button text"><input className="input" placeholder="Uses the default" value={form.design.buttonText || ''} onChange={(e) => setD('buttonText', e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {color('buttonColor', 'Button', '#B34D22')}{color('backgroundColor', 'Background', '#ECEDF0')}{color('cardColor', 'Panel', '#FFFFFF')}{color('textColor', 'Text', '#1A1A1A')}
          </div>
          <ImageField label="Header image" fileId={form.design.headerImageId} onChange={(v) => setD('headerImageId', v)} />
          <div className="flex gap-2">
            <button className="btn-primary">Save and preview</button>
            <button type="button" className="btn-outline" onClick={() => setForm(current.defaults)}>Reset to default</button>
          </div>
        </form>
      </Card>
      <Card title="Preview">
        <iframe title="Email preview" srcDoc={current.preview} sandbox="" className="h-[640px] w-full rounded-lg border border-line bg-white" />
      </Card>
    </div>
  )
}

function CardDesign() {
  const { data, reload } = useFetch('/settings/card-design')
  const { user } = useAuth()
  const [d, setD] = useState(null)
  useEffect(() => { if (data) setD(data.card) }, [data])
  if (!d) return <PageLoader />
  const set = (k) => (e) => setD({ ...d, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const save = async (e) => {
    e.preventDefault()
    try {
      await api.put('/settings/card-design', d)
      toast.success('Card design saved')
      reload()
    } catch (err) { fail(err) }
  }
  const SIZES = { 'Bank card (85.6 × 54)': [85.6, 54], 'Badge, portrait (54 × 85.6)': [54, 85.6], 'Large badge (100 × 70)': [100, 70] }
  const sample = { name: user.name, jobTitle: user.jobTitle || 'Job title', department: user.department?.name || 'Department', employeeNo: user.employeeNo, photoFileId: user.photoFileId }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Employee card design">
        <form onSubmit={save} className="space-y-3">
          <Field label="Preset size"><select className="input" aria-label="Preset size" value="" onChange={(e) => { const [w, h] = SIZES[e.target.value] || []; if (w) setD({ ...d, widthMm: w, heightMm: h }) }}><option value="">Choose a preset</option>{Object.keys(SIZES).map((k) => <option key={k}>{k}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Width (mm)"><input type="number" step="0.1" className="input" value={d.widthMm} onChange={set('widthMm')} /></Field>
            <Field label="Height (mm)"><input type="number" step="0.1" className="input" value={d.heightMm} onChange={set('heightMm')} /></Field>
            <Field label="Corners (mm)"><input type="number" step="0.5" className="input" value={d.radiusMm} onChange={set('radiusMm')} /></Field>
            <Field label="QR size (mm)"><input type="number" className="input" value={d.qrSizeMm} onChange={set('qrSizeMm')} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Background"><input type="color" className="input !h-[38px] !p-1" value={d.backgroundColor} onChange={set('backgroundColor')} /></Field>
            <Field label="Text"><input type="color" className="input !h-[38px] !p-1" value={d.textColor} onChange={set('textColor')} /></Field>
            <Field label="Accent"><input type="color" className="input !h-[38px] !p-1" value={d.accentColor} onChange={set('accentColor')} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Card title"><input className="input" value={d.title} onChange={set('title')} /></Field>
            <Field label="Footer text"><input className="input" value={d.footerText} onChange={set('footerText')} /></Field>
          </div>
          <ImageField label="Logo" fileId={d.logoFileId} onChange={(v) => setD({ ...d, logoFileId: v })} />
          <ImageField label="Background image" fileId={d.backgroundImageId} onChange={(v) => setD({ ...d, backgroundImageId: v })} />
          <div className="grid grid-cols-2 gap-2 text-[13px]">
            {[['showPhoto', 'Photo'], ['showJobTitle', 'Job title'], ['showDepartment', 'Department'], ['showEmployeeNo', 'Employee number']].map(([k, label]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-brand" checked={d[k]} onChange={set(k)} />{label}</label>)}
          </div>
          <button className="btn-primary">Save card design</button>
        </form>
      </Card>
      <Card title="Preview" className="self-start">
        <div className="flex justify-center overflow-x-auto py-4"><CardView design={{ ...d, widthMm: Number(d.widthMm), heightMm: Number(d.heightMm), radiusMm: Number(d.radiusMm), qrSizeMm: Number(d.qrSizeMm) }} person={sample} companyName={user.company?.name} qr="/logo.svg" /></div>
        <p className="text-xs text-ink-muted">The real QR replaces the logo here. Employees see their card under My Card, and scan it at the Card Kiosk.</p>
      </Card>
    </div>
  )
}

const STEP_KINDS = { MANAGER: "The person's manager", HR: 'HR (company admins)', ROLE: 'Anyone with a role', USER: 'A specific person' }

function WorkflowForm({ workflow, roles, people, onClose, onSaved }) {
  const [form, setForm] = useState({ name: workflow?.name || '', appliesTo: workflow?.appliesTo || 'LEAVE', steps: workflow?.steps || [{ kind: 'MANAGER' }, { kind: 'HR' }] })
  const setStep = (i, patch) => setForm({ ...form, steps: form.steps.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const submit = async (e) => {
    e.preventDefault()
    try {
      if (workflow?.id) await api.patch(`/settings/workflows/${workflow.id}`, form)
      else await api.post('/settings/workflows', form)
      onSaved()
    } catch (err) { fail(err) }
  }
  return (
    <Modal title={workflow?.id ? 'Edit workflow' : 'New workflow'} wide onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><input required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Used for"><select className="input" value={form.appliesTo} onChange={(e) => setForm({ ...form, appliesTo: e.target.value })}><option value="LEAVE">Leave</option><option value="TIMESHEET">Timesheets</option></select></Field>
        </div>
        <div className="eyebrow">Approval steps, in order</div>
        {form.steps.map((step, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="w-6 text-center text-[13px] font-bold">{i + 1}</span>
            <select className="input !w-auto" aria-label={`Step ${i + 1} approver`} value={step.kind} onChange={(e) => setStep(i, { kind: e.target.value, roleId: undefined, userId: undefined })}>{Object.entries(STEP_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            {step.kind === 'ROLE' && <select required className="input !w-auto" aria-label="Role" value={step.roleId || ''} onChange={(e) => setStep(i, { roleId: e.target.value })}><option value="">Choose a role</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}
            {step.kind === 'USER' && <select required className="input !w-auto" aria-label="Person" value={step.userId || ''} onChange={(e) => setStep(i, { userId: e.target.value })}><option value="">Choose a person</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
            <button type="button" className="btn-outline !p-2" aria-label={`Remove step ${i + 1}`} disabled={form.steps.length === 1} onClick={() => setForm({ ...form, steps: form.steps.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
          </div>
        ))}
        <button type="button" className="btn-outline" onClick={() => setForm({ ...form, steps: [...form.steps, { kind: 'MANAGER' }] })}><Plus size={14} />Add a step</button>
        <div className="flex justify-end gap-2"><button type="button" className="btn-outline" onClick={onClose}>Cancel</button><button className="btn-primary">Save</button></div>
      </form>
    </Modal>
  )
}

function Workflows() {
  const { data, reload } = useFetch('/settings/workflows')
  const { data: options } = useFetch('/employees/options')
  const { data: people } = useFetch('/timesheets/people')
  const [editing, setEditing] = useState(null)
  if (!data) return <PageLoader />
  const roleName = (id) => options?.roles.find((r) => r.id === Number(id))?.name || 'role'
  const label = (s) => (s.kind === 'ROLE' ? roleName(s.roleId) : s.kind === 'USER' ? people?.people.find((p) => p.id === Number(s.userId))?.name || 'person' : s.kind === 'HR' ? 'HR' : 'Manager')
  const setTimesheet = (workflowId) => api.put('/settings/company', { timesheets: { workflowId: workflowId ? Number(workflowId) : null } }).then(reload).catch(fail)
  return (
    <div className="space-y-4">
      <Card title="Workflows" action={<button className="btn-primary" onClick={() => setEditing({})}><Plus size={14} />New workflow</button>}>
        <p className="mb-2 text-xs text-ink-muted">A workflow is the chain of approvals something goes through. Attach it to a leave type under Leave, or use it for timesheets below.</p>
        {!data.workflows.length && <Empty>No workflows yet. Each leave type picks Manager then HR, or straight to HR.</Empty>}
        <div className="divide-y divide-line">
          {data.workflows.map((w) => (
            <div key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
              <span><b>{w.name}</b> <Pill>{w.appliesTo === 'LEAVE' ? 'Leave' : 'Timesheets'}</Pill> <span className="text-ink-soft">{w.steps.map(label).join(' → ')}</span></span>
              <span className="flex gap-1.5"><button className="btn-outline btn-sm" onClick={() => setEditing(w)}>Edit</button><button className="btn-outline btn-sm" aria-label={`Delete ${w.name}`} onClick={() => api.delete(`/settings/workflows/${w.id}`).then(reload).catch(fail)}><Trash2 size={12} /></button></span>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Timesheet approval">
        <div className="max-w-sm"><Field label="Workflow for weekly timesheets"><select className="input" value={data.timesheetWorkflowId || ''} onChange={(e) => setTimesheet(e.target.value)}><option value="">Default: their manager</option>{data.workflows.filter((w) => w.appliesTo === 'TIMESHEET').map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field></div>
      </Card>
      {editing && options && <WorkflowForm workflow={editing.id ? editing : null} roles={options.roles} people={people?.people || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </div>
  )
}

function Security() {
  const { data, reload } = useFetch('/settings/security')
  const [form, setForm] = useState(null)
  useEffect(() => { if (data) setForm({ security: { ...data.security, ipAllowlist: data.security.ipAllowlist.join(', ') }, chat: data.chat }) }, [data])
  if (!form) return <PageLoader />
  const sec = (k, v) => setForm({ ...form, security: { ...form.security, [k]: v } })
  const save = async (e) => {
    e.preventDefault()
    try {
      const { ipAllowlist, minPasswordLength, sessionIdleHours, ...rest } = form.security
      await api.put('/settings/security', { chat: { retentionMonths: Number(form.chat.retentionMonths) }, security: { ...rest, minPasswordLength: Number(minPasswordLength), sessionIdleHours: Number(sessionIdleHours), ipAllowlist: ipAllowlist.split(',').map((x) => x.trim()).filter(Boolean) } })
      toast.success('Saved')
      reload()
    } catch (err) { fail(err) }
  }
  return (
    <Card title="Security rules">
      <form onSubmit={save} className="grid max-w-2xl gap-3 sm:grid-cols-2">
        <Field label="Minimum password length"><input type="number" min="8" className="input" value={form.security.minPasswordLength} onChange={(e) => sec('minPasswordLength', e.target.value)} /></Field>
        <Field label="Session timeout (idle hours)"><input type="number" min="1" className="input" value={form.security.sessionIdleHours} onChange={(e) => sec('sessionIdleHours', e.target.value)} /></Field>
        <Field label="Chat retention (months)"><input type="number" min="1" className="input" value={form.chat.retentionMonths} onChange={(e) => setForm({ ...form, chat: { retentionMonths: e.target.value } })} /></Field>
        <Field label="IP allowlist" hint="Comma-separated. Empty allows any network."><input className="input" value={form.security.ipAllowlist} onChange={(e) => sec('ipAllowlist', e.target.value)} /></Field>
        <div className="flex items-center justify-between rounded-xl bg-subtle px-3 py-2 text-[13px] sm:col-span-2">Require 2FA for company admins<Toggle label="Require 2FA" checked={form.security.adminTwoFactorRequired} onChange={(v) => sec('adminTwoFactorRequired', v)} /></div>
        <div><button className="btn-primary">Save</button></div>
      </form>
    </Card>
  )
}

function DataRequests() {
  const { data, reload } = useFetch('/system/data-requests')
  const { data: people } = useFetch('/timesheets/people')
  const { user } = useAuth()
  const [form, setForm] = useState({ userId: '', reason: '' })
  const add = async (e) => {
    e.preventDefault()
    try {
      await api.post('/system/data-requests', form)
      setForm({ userId: '', reason: '' })
      reload()
    } catch (err) { fail(err) }
  }
  const run = (r) => download(`/system/data-requests/${r.id}/run`, `data-export-${r.userId}.json`, { method: 'post' }).then(reload).catch(fail)
  return (
    <Card title="POPIA data requests">
      <form onSubmit={add} className="mb-3 grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
        <select required className="input" aria-label="Person" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}><option value="">Choose a person</option><option value={user.id}>{user.name}</option>{people?.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <input required className="input" placeholder="Reason" aria-label="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        <button className="btn-primary">Log request</button>
      </form>
      {!data?.requests.length && <Empty>No requests.</Empty>}
      <div className="divide-y divide-line">
        {data?.requests.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
            <span><b>{r.userName}</b> · {r.reason}</span>
            <span className="flex items-center gap-2"><Pill tone={r.status === 'COMPLETED' ? 'ok' : 'warn'}>{r.status === 'COMPLETED' ? 'Completed' : 'Pending'}</Pill><button className="btn-outline btn-sm" onClick={() => run(r)}>Export</button></span>
          </div>
        ))}
      </div>
    </Card>
  )
}

function Teams() {
  const { data, reload } = useFetch('/settings/teams')
  const { data: options } = useFetch('/employees/options')
  const [form, setForm] = useState({ name: '', departmentId: '', leadId: '' })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const add = async (e) => {
    e.preventDefault()
    try {
      await api.post('/settings/teams', form)
      setForm({ name: '', departmentId: '', leadId: '' })
      reload()
    } catch (err) { fail(err) }
  }
  return (
    <Card title="Teams" className="lg:col-span-2">
      <form onSubmit={add} className="mb-3 grid gap-2 sm:grid-cols-4">
        <input required className="input" placeholder="e.g. Software Development" aria-label="Team name" value={form.name} onChange={set('name')} />
        <select className="input" aria-label="Department" value={form.departmentId} onChange={set('departmentId')}><option value="">No department</option>{options?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select className="input" aria-label="Team lead" value={form.leadId} onChange={set('leadId')}><option value="">No lead</option>{options?.managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <button className="btn-primary">Add team</button>
      </form>
      {!data?.teams.length && <Empty>No teams yet.</Empty>}
      <div className="grid gap-x-6 sm:grid-cols-2">
        {data?.teams.map((t) => <div key={t.id} className="flex justify-between gap-2 border-b border-line py-1.5 text-[13px]"><span><b>{t.name}</b> <span className="text-ink-muted">· {t.department?.name || 'No department'}</span></span><span className="text-ink-soft">{t.lead?.name ? `${t.lead.name} · ` : ''}{t.people} people</span></div>)}
      </div>
    </Card>
  )
}

const TABS = [
  ['rules', 'Attendance rules', 'org.configure'], ['leave', 'Leave', 'leave.configure'], ['holidays', 'Holidays', 'org.configure'], ['org', 'Organisation', 'org.configure'], ['workflows', 'Workflows', 'org.configure'],
  ['branding', 'Theme & branding', 'branding.manage'], ['email', 'Email templates', 'branding.manage'], ['cards', 'Employee cards', 'branding.manage'], ['security', 'Security', 'org.configure'], ['data', 'Data requests', 'users.manage'],
]

export default function Policies() {
  const [params, setParams] = useSearchParams()
  const { can } = useAuth()
  const tabs = TABS.filter(([, , perm]) => can(perm))
  const tab = params.get('tab') || tabs[0]?.[0]
  return (
    <>
      <PageHeader title="Company Settings" subtitle="How your company works, and how the system looks for your people" />
      <div className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {tabs.map(([key, label]) => <button key={key} onClick={() => setParams({ tab: key })} className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold ${tab === key ? 'border-brand text-brand-ink' : 'border-transparent text-ink-soft hover:text-ink'}`}>{label}</button>)}
      </div>
      {tab === 'rules' && <Attendance />}
      {tab === 'leave' && <LeaveTypes />}
      {tab === 'holidays' && <Holidays />}
      {tab === 'org' && <Organisation />}
      {tab === 'branding' && <Branding />}
      {tab === 'email' && <EmailTemplates />}
      {tab === 'cards' && <CardDesign />}
      {tab === 'workflows' && <Workflows />}
      {tab === 'security' && <Security />}
      {tab === 'data' && <DataRequests />}
    </>
  )
}
