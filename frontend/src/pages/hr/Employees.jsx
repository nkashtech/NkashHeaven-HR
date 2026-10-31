import { useEffect, useMemo, useState } from 'react'
import { SECTIONS, SectionFields, masksOf, toForm } from '../../components/EmployeeDetails'
import CardView from '../cards/CardView'
import { Link, useSearchParams } from 'react-router-dom'
import { Download, Plus, Search, Upload, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useFetch } from '../../components/hooks'
import { Avatar, Field, Kpi, Modal, PageError, PageHeader, PageLoader, Pill, StatusPill, Table } from '../../components/ui'
import { companyToday, fmtDay, fmtDateTime } from '../../utils/format'
import api, { errorMessage } from '../../services/api'

const ROLE_TONE = { EMPLOYEE: 'neutral', MANAGER: 'info', ADMIN: 'brand' }
const INVITE = { NONE: 'Not invited', SENT: 'Sent', OPENED: 'Opened', ACTIVATED: 'Activated', EXPIRED: 'Expired', BOUNCED: 'Bounced' }

const STEPS = [['job', 'Employment'], ...SECTIONS.map((x) => [x.key, x.label])]

function EmployeeForm({ options, employee, onClose, onSaved }) {
  const editing = Boolean(employee)
  const [names] = useState(() => { const p = (employee?.name || '').split(' '); return { firstName: p[0] || '', lastName: p.slice(1).join(' ') } })
  const [form, setForm] = useState({
    ...names, email: employee?.email || '', employeeNo: employee?.employeeNo || options.nextEmployeeNo, jobTitle: employee?.jobTitle || '',
    roleId: employee?.accessRole?.id || options.roles.find((r) => r.scope === 'SELF')?.id || '', departmentId: employee?.department?.id || '', teamId: employee?.team?.id || '', managerId: employee?.manager?.id || '',
    scheduleId: employee?.schedule?.id || options.schedules[0]?.id || '', startDate: employee?.startDate || companyToday(), salaryBand: employee?.salaryBand || '',
  })
  const [details, setDetails] = useState(toForm({}))
  const [masks, setMasks] = useState({})
  const [step, setStep] = useState('job')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!editing) return
    api.get(`/profile/${employee.id}`).then(({ data }) => { setDetails(toForm(data.profile)); setMasks(masksOf(data.profile)) }).catch((e) => toast.error(errorMessage(e)))
  }, [editing, employee])
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const body = { ...form, name: `${form.firstName} ${form.lastName}`.trim(), profile: details }
      if (editing) await api.patch(`/employees/${employee.id}`, body)
      else await api.post('/employees', body)
      toast.success(editing ? 'Saved' : 'Employee created and welcome email queued')
      onSaved()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const others = (list) => list.filter((m) => m.id !== employee?.id)
  const section = SECTIONS.find((x) => x.key === step)
  return (
    <Modal title={editing ? `Edit ${employee.name}` : 'New employee'} wide onClose={onClose}>
      <form onSubmit={submit}>
        <div className="mb-3 flex gap-1 overflow-x-auto border-b border-line pb-1">
          {STEPS.map(([k, label]) => <button type="button" key={k} onClick={() => setStep(k)} className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${step === k ? 'bg-brand-soft text-brand-ink' : 'text-ink-soft hover:bg-subtle'}`}>{label}</button>)}
        </div>
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          {step === 'job' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="First name"><input required className="input" value={form.firstName} onChange={set('firstName')} /></Field>
              <Field label="Last name"><input required className="input" value={form.lastName} onChange={set('lastName')} /></Field>
              <Field label="Work email" hint={editing ? 'To change it, resend the invite.' : 'Any provider, including Gmail.'}><input type="email" required disabled={editing} className="input" placeholder="name@gmail.com" value={form.email} onChange={set('email')} /></Field>
              <Field label="Employee no."><input required disabled={editing} className="input" value={form.employeeNo} onChange={set('employeeNo')} /></Field>
              <Field label="Position" hint="Shown under their name, e.g. Junior Developer."><input required className="input" placeholder="Junior Developer" value={form.jobTitle} onChange={set('jobTitle')} /></Field>
              <Field label="Role" hint="Roles are set up under Roles."><select className="input" value={form.roleId} onChange={set('roleId')}>{options.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
              <Field label="Department"><select className="input" value={form.departmentId} onChange={set('departmentId')}><option value="">None</option>{options.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
              <Field label="Team"><select className="input" value={form.teamId} onChange={set('teamId')}><option value="">None</option>{options.teams.filter((t) => !form.departmentId || !t.departmentId || t.departmentId === Number(form.departmentId)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
              <Field label="Manager" hint="Approves their leave before HR, if the leave type asks for it."><select className="input" value={form.managerId} onChange={set('managerId')}><option value="">None</option>{others(options.managers).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
              <Field label="Work schedule"><select className="input" value={form.scheduleId} onChange={set('scheduleId')}>{options.schedules.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
              <Field label="Start date"><input type="date" required className="input" value={form.startDate} onChange={set('startDate')} /></Field>
              {!editing && (
                <div className="rounded-xl bg-subtle px-3 py-2 text-[13px] sm:col-span-2">
                  <div className="mb-1 text-xs font-bold">Initial leave allocations</div>
                  {options.leaveTypes.map((t) => <div key={t.id} className="flex justify-between"><span>{t.name}</span><span className="text-ink-soft">{t.accrualPerMonth ? `${t.accrualPerMonth} accrued monthly` : `${t.defaultDays || 0} days`}</span></div>)}
                </div>
              )}
            </div>
          ) : <SectionFields section={section} value={details} onChange={setDetails} masks={masks} mode="hr" />}
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
          <span className="text-xs text-ink-muted">{editing ? 'Every change is written to the audit log.' : 'Only Employment is required. They get a welcome email with a temporary password.'}</span>
          <button className="btn-primary" disabled={busy}>{editing ? 'Save changes' : 'Create & send invite'}</button>
        </div>
      </form>
    </Modal>
  )
}

// One person's screens and actions on top of their role, e.g. an unpaid intern without payslips.
function AccessModal({ employee, access, onClose, onSaved }) {
  const { data } = useFetch('/roles')
  const [overrides, setOverrides] = useState(access.overrides || {})
  const [busy, setBusy] = useState(false)
  if (!data) return null
  const groups = [...new Set(data.permissions.map((p) => p.group))]
  const fromRole = (key) => access.rolePermissions.includes(key)
  const state = (key) => (key in overrides ? (overrides[key] ? 'on' : 'off') : 'role')
  const choose = (key, value) => {
    const next = { ...overrides }
    if (value === 'role' || (value === 'on') === fromRole(key)) delete next[key]
    else next[key] = value === 'on'
    setOverrides(next)
  }
  const save = async () => {
    setBusy(true)
    try {
      await api.put(`/employees/${employee.id}/access`, { overrides })
      toast.success('Access saved. It applies within seconds.')
      onSaved()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const changed = Object.keys(overrides).length
  return (
    <Modal title={`${employee.name}'s access`} wide onClose={onClose}>
      <p className="text-[13px] text-ink-soft">Starts from the <b>{employee.accessRole?.name}</b> role. Change only what's different for this person. {changed ? `${changed} change${changed === 1 ? '' : 's'} from the role.` : 'Same as the role.'}</p>
      <div className="mt-3 grid max-h-[55vh] gap-5 overflow-y-auto pr-1 sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g}>
            <h3 className="eyebrow mb-1.5">{g}</h3>
            <div className="space-y-1.5">
              {data.permissions.filter((p) => p.group === g).map((p) => (
                <label key={p.key} className="flex items-center justify-between gap-2 text-[13px]">
                  <span className={state(p.key) === 'role' ? '' : 'font-semibold'}>{p.label}</span>
                  <select className="input !w-auto !py-1 !text-xs" aria-label={p.label} value={state(p.key)} onChange={(e) => choose(p.key, e.target.value)}>
                    <option value="role">Role: {fromRole(p.key) ? 'on' : 'off'}</option>
                    <option value="on">On</option>
                    <option value="off">Off</option>
                  </select>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3">
        <button className="btn-outline" onClick={() => setOverrides({})} disabled={!changed}>Reset to role</button>
        <button className="btn-primary" onClick={save} disabled={busy}>Save access</button>
      </div>
    </Modal>
  )
}

function Detail({ id, onClose, onEdit, onChanged }) {
  const { data, reload } = useFetch(`/employees/${id}`)
  const [card, setCard] = useState(null)
  const [access, setAccess] = useState(false)
  if (!data) return null
  const e = data.employee
  const act = (fn, ok) => async () => {
    try {
      await fn()
      toast.success(ok)
      reload()
      onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const Row = ({ k, v }) => <div className="flex justify-between gap-3 border-b border-line py-1.5 text-[13px]"><span className="text-ink-soft">{k}</span><span className="text-right font-medium">{v || '—'}</span></div>
  return (
    <Modal title={e.name} wide onClose={onClose}>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Row k="Role" v={e.accessRole?.name} /><Row k="Position" v={e.jobTitle} /><Row k="Department" v={e.department?.name} /><Row k="Team" v={e.team?.name} /><Row k="Manager" v={e.manager?.name} />
          <Row k="Schedule" v={e.schedule?.name} /><Row k="Start date" v={fmtDay(e.startDate, 'd MMM yyyy')} /><Row k="Invite" v={INVITE[e.inviteStatus]} /><Row k="Last sign-in" v={e.lastLoginAt ? fmtDateTime(e.lastLoginAt) : 'Never'} /><Row k="Now" v={data.presence?.label} />
        </div>
        <div>
          <h3 className="mb-1 text-[13px] font-bold">Change history</h3>
          {!data.history.length && <p className="text-[13px] text-ink-muted">No role or reporting changes yet.</p>}
          <div className="max-h-56 space-y-1 overflow-y-auto text-xs">
            {data.history.map((h) => <div key={h.id}><b>{h.field}</b>: {h.oldValue || '—'} → {h.newValue || '—'} · changed by {h.actorName} · {fmtDateTime(h.createdAt)}</div>)}
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
        {data.manageable && <button className="btn-outline" onClick={() => onEdit(e)}>Edit</button>}
        {data.access && <button className="btn-outline" onClick={() => setAccess(true)}>Access{Object.keys(data.access.overrides).length ? ` (${Object.keys(data.access.overrides).length} changed)` : ''}</button>}
        <Link className="btn-outline" to={`/people/${id}`}>View profile</Link>
        {data.manageable && e.inviteStatus !== 'ACTIVATED' && e.active && <button className="btn-outline" onClick={act(() => api.post(`/employees/${id}/resend-invite`, {}), 'New invite sent')}>Resend invite</button>}
        {data.manageable && (e.active ? <button className="btn-danger" onClick={act(() => api.post(`/employees/${id}/archive`), 'Archived')}>Archive</button> : <button className="btn-outline" onClick={act(() => api.post(`/employees/${id}/restore`), 'Restored')}>Restore</button>)}
        <button className="btn-outline" onClick={() => api.get(`/cards/${id}`).then((r) => setCard(r.data)).catch((err) => toast.error(errorMessage(err)))}>Employee card</button>
      </div>
      {!data.manageable && <p className="mt-2 text-xs text-ink-muted">Only the company admin can change HR and admin accounts.</p>}
      {access && <AccessModal employee={e} access={data.access} onClose={() => setAccess(false)} onSaved={() => { setAccess(false); reload() }} />}
      {card && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <CardView {...card} />
          <button className="btn-outline" onClick={() => api.post(`/cards/${id}/reissue`).then((r) => { setCard(r.data); toast.success('New card issued. The old one no longer works.') }).catch((err) => toast.error(errorMessage(err)))}>Reissue card</button>
        </div>
      )}
    </Modal>
  )
}

function ImportCsv({ onClose, onDone }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState(null)
  const onFile = async (e) => { if (e.target.files[0]) setText(await e.target.files[0].text()) }
  const run = async () => {
    try {
      const { data } = await api.post('/employees/import', { csv: text })
      setResult(data)
      onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  return (
    <Modal title="Import employees from CSV" wide onClose={onClose}>
      <p className="text-[13px] text-ink-soft">Columns: <code className="text-xs">name, email, role, start_date</code> are required. Optional: <code className="text-xs">employee_no, position, department, schedule, manager</code>. Names must match exactly. Every person gets a welcome email.</p>
      <input type="file" accept=".csv" className="mt-3 text-[13px]" onChange={onFile} aria-label="CSV file" />
      <textarea rows={6} className="input mt-2 font-mono !text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder="name,email,role,start_date" aria-label="CSV content" />
      <button className="btn-primary mt-2" disabled={!text.trim()} onClick={run}>Import</button>
      {result && (
        <div className="mt-3 text-[13px]">
          <p className="font-semibold">{result.created} created, {result.failed} failed</p>
          {result.results.filter((r) => !r.ok).map((r) => <p key={r.line} className="text-xs text-bad">Line {r.line} ({r.email}): {r.error}</p>)}
        </div>
      )}
    </Modal>
  )
}

export default function Employees() {
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('active')
  const [creating, setCreating] = useState(params.get('new') === '1')
  const [editing, setEditing] = useState(null)
  const [selected, setSelected] = useState(null)
  const [importing, setImporting] = useState(false)
  const url = `/employees?status=${status}${departmentId ? `&departmentId=${departmentId}` : ''}${role ? `&roleId=${role}` : ''}`
  const { data, error, reload } = useFetch(url)
  const { data: options, reload: reloadOptions } = useFetch('/employees/options')
  const { data: hr, reload: reloadHr } = useFetch('/dashboard/hr')
  const { data: company } = useFetch('/settings/company')

  useEffect(() => { if (params.get('new')) setParams({}, { replace: true }) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const n = q.toLowerCase()
    return (data?.employees || []).filter((e) => !n || `${e.name} ${e.email} ${e.employeeNo}`.toLowerCase().includes(n))
  }, [data, q])

  if (error) return <PageError message={error} onRetry={reload} />
  if (!data || !options) return <PageLoader />
  const saved = () => { setCreating(false); setEditing(null); reload(); reloadOptions(); reloadHr() }
  const exportCsv = () => {
    const head = 'employee_no,name,email,position,role,department,manager,start_date\n'
    const lines = rows.map((e) => [e.employeeNo, e.name, e.email, e.jobTitle, e.accessRole?.name, e.department?.name, e.manager?.name, e.startDate].map((v) => `"${String(v ?? '').replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"`).join(','))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([head + lines.join('\n')], { type: 'text/csv' }))
    a.download = 'employees.csv'
    a.click()
  }
  return (
    <>
      <PageHeader title="Employees" subtitle="Only HR can create users and assign roles, positions and managers">
        <button className="btn-primary" onClick={() => { setEditing(null); setCreating(true) }}><Plus size={14} />Add employee</button>
      </PageHeader>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Active employees" value={hr?.active ?? '—'} />
        <Kpi label="Checked in now" value={hr?.counts.in ?? '—'} />
        <Kpi label="On leave today" value={hr?.leaveToday.total ?? '—'} />
        <Kpi label="Pending approvals" value={hr?.approvalsPending ?? '—'} tone="brand" />
        <Kpi label="Attendance lock date" value={company ? fmtDay(company.lockDate, 'd MMM yyyy') : '—'} />
      </div>
      <div className="mt-4">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input className="input !pl-9" placeholder="Search name, email, ID" aria-label="Search employees" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select className="input !w-auto font-semibold" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} aria-label="Department">
              <option value="">Department: All</option>{options.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select className="input !w-auto font-semibold" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
              <option value="">Role: All</option>{options.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <select className="input !w-auto font-semibold" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option>
            </select>
            <button className="btn-outline" onClick={() => setImporting(true)}><Upload size={14} />Import CSV</button>
            <button className="btn-outline" onClick={exportCsv}><Download size={14} />Export</button>
          </div>
          <Table>
            <thead className="bg-subtle"><tr><th className="th">Employee</th><th className="th">Role</th><th className="th">Department</th><th className="th">Manager</th><th className="th">Invite</th></tr></thead>
            <tbody className="divide-y divide-line">
              {!rows.length && <tr><td colSpan={5} className="td text-center text-ink-muted">Nobody matches.</td></tr>}
              {rows.map((e) => (
                <tr key={e.id} className="cursor-pointer hover:bg-subtle/50" onClick={() => setSelected(e.id)}>
                  <td className="td"><div className="flex items-center gap-2.5"><Avatar name={e.name} size={32} /><div className="min-w-0"><div className="truncate font-semibold">{e.name}</div><div className="truncate text-xs text-ink-muted">{e.jobTitle || e.email}</div></div></div></td>
                  <td className="td"><Pill tone={ROLE_TONE[e.role]}>{e.accessRole?.name || '—'}</Pill></td>
                  <td className="td whitespace-nowrap">{e.department?.name || '—'}</td>
                  <td className="td whitespace-nowrap">{e.manager?.name || '—'}</td>
                  <td className="td"><StatusPill status={e.inviteStatus}>{INVITE[e.inviteStatus]}</StatusPill></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </div>
      {(creating || editing) && <EmployeeForm key={editing?.id || 'new'} options={options} employee={editing} onClose={() => { setCreating(false); setEditing(null) }} onSaved={saved} />}
      {selected && <Detail id={selected} onClose={() => setSelected(null)} onEdit={(e) => { setSelected(null); setCreating(false); setEditing(e) }} onChanged={() => { reload(); reloadHr() }} />}
      {importing && <ImportCsv onClose={() => setImporting(false)} onDone={saved} />}
    </>
  )
}
