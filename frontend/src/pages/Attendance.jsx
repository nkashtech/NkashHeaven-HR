import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CalendarRange, Lock, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../contexts/AuthContext'
import { useFetch } from '../components/hooks'
import { Card, Empty, Field, Modal, PageError, PageHeader, PageLoader, ReasonModal, Segmented, StatusPill, Table } from '../components/ui'
import { addDays, companyToday, fmtDateTime, fmtDay, hm, mondayOf } from '../utils/format'
import api, { errorMessage } from '../services/api'

function EditModal({ row, onClose, onSaved }) {
  const [form, setForm] = useState({ checkIn: row.checkInLocal, checkOut: row.checkOutLocal, reason: '' })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.patch(`/attendance/${row.id}`, form)
      toast.success('Record updated')
      onSaved()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={`Edit ${fmtDay(row.date, 'EEE d MMM yyyy')}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Date" hint="The date cannot change."><input className="input" value={row.date} disabled /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Check in"><input type="time" required className="input" value={form.checkIn} onChange={set('checkIn')} /></Field>
          <Field label="Check out"><input type="time" required className="input" value={form.checkOut} onChange={set('checkOut')} /></Field>
        </div>
        <Field label="Reason" hint="Kept in the edit history."><textarea required rows={2} className="input" value={form.reason} onChange={set('reason')} /></Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>Save changes</button>
        </div>
      </form>
    </Modal>
  )
}

export function AddRecordModal({ prefill, onClose, onSaved }) {
  const { data } = useFetch('/people/directory')
  const [form, setForm] = useState({ userId: prefill?.userId || '', date: prefill?.date || '', checkIn: '08:00', checkOut: '17:00', reason: prefill?.note || '' })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    try {
      await api.post('/attendance', form)
      toast.success('Record added and the employee notified')
      onSaved()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  return (
    <Modal title="Add a missed attendance" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Employee">
          <select required className="input" value={form.userId} onChange={set('userId')}>
            <option value="">Choose</option>
            {data?.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Date"><input type="date" required max={addDays(companyToday(), -1)} className="input" value={form.date} onChange={set('date')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Check in"><input type="time" required className="input" value={form.checkIn} onChange={set('checkIn')} /></Field>
          <Field label="Check out"><input type="time" required className="input" value={form.checkOut} onChange={set('checkOut')} /></Field>
        </div>
        <Field label="Reason" hint="Mandatory. Written to the audit log."><textarea required rows={2} className="input" value={form.reason} onChange={set('reason')} /></Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary">Add record</button>
        </div>
      </form>
    </Modal>
  )
}

function groupKey(row, by) {
  if (by === 'employee') return row.userName
  if (by === 'week') return `Week of ${fmtDay(mondayOf(row.date), 'd MMM yyyy')}`
  return null
}

const RANGES = { 7: 'Last 7 days', 30: 'Last 30 days', 90: 'Last 90 days' }

export default function Attendance() {
  const { user, isAdmin, can } = useAuth()
  const isLead = user.role !== 'EMPLOYEE' || user.leadsPeople
  const [scope, setScope] = useState('mine')
  const [range, setRange] = useState(30)
  const [q, setQ] = useState('')
  const [by, setBy] = useState('day')
  const [departmentId, setDepartmentId] = useState('')
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)
  const [asking, setAsking] = useState(null)
  const [removing, setRemoving] = useState(null)
  const today = companyToday()
  const url = `/attendance?scope=${scope}&from=${addDays(today, -(range - 1))}&to=${today}${departmentId ? `&departmentId=${departmentId}` : ''}`
  const { data, error, reload } = useFetch(url)
  const { data: edits, reload: reloadEdits } = useFetch('/attendance/edits')
  const { data: settings } = useFetch(isAdmin ? '/settings/departments' : null)

  useEffect(() => {
    const again = () => { reload(); reloadEdits() }
    window.addEventListener('attendance:changed', again)
    return () => window.removeEventListener('attendance:changed', again)
  }, [reload, reloadEdits])

  const rows = useMemo(() => {
    const needle = q.toLowerCase()
    return (data?.items || []).filter((r) => !needle || `${r.userName} ${r.date} ${r.status.label}`.toLowerCase().includes(needle))
  }, [data, q])

  if (error) return <PageError message={error} onRetry={reload} />
  if (!data) return <PageLoader />

  const team = scope === 'team'
  const saved = () => { setEditing(null); setAdding(false); reload(); reloadEdits() }
  const canEdit = (r) => !r.locked || isAdmin
  const remove = async (reason) => {
    try {
      await api.delete(`/attendance/${removing.id}`, { data: { reason } })
      toast.success('Record removed')
      setRemoving(null)
      reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const ask = async (note) => {
    try {
      await api.post('/attendance/missed-day', { date: asking.date, note })
      toast.success('HR has been asked')
      setAsking(null)
      reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  let lastGroup = null
  const cols = team ? 7 : 6
  return (
    <>
      <PageHeader title={team ? (isAdmin ? 'All Attendance' : 'Team Attendance') : 'My Attendance'} subtitle={team ? 'Filter, group and correct your team\'s records' : 'Your check-in and check-out records'}>
        {isLead && <Segmented value={scope} onChange={setScope} options={[['mine', 'Mine'], ['team', isAdmin ? 'Everyone' : 'Team']]} />}
        {data.canCreate && <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={14} />New</button>}
      </PageHeader>

      {!team && (
        <div className="mb-4 flex gap-2.5 rounded-xl border border-brand/20 bg-brand-soft px-4 py-3 text-[13px] text-brand-ink">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <p><b>Records are created only by Check In / Check Out.</b> You can correct the times on an existing record until the period locks (lock date: {fmtDay(data.lockDate, 'd MMM yyyy')}). To add a day you missed, contact HR.</p>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input className="input !pl-9" placeholder={team ? 'Search name or status' : 'Search records'} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search records" />
        </div>
        <label className="relative">
          <CalendarRange size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <select className="input !w-auto !pl-9 font-semibold" value={range} onChange={(e) => setRange(Number(e.target.value))} aria-label="Date range">
            {Object.entries(RANGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {team && isAdmin && (
          <select className="input !w-auto font-semibold" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} aria-label="Department">
            <option value="">All departments</option>
            {settings?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        <select className="input !w-auto font-semibold" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Group by">
          <option value="day">Group by: Day</option><option value="week">Group by: Week</option>{team && <option value="employee">Group by: Employee</option>}
        </select>
        <div className="ml-auto text-[13px] text-ink-soft">Worked: <b className="text-ink">{hm(data.summary.worked)}</b> · Extra: <b className="text-ink">{hm(data.summary.extra)}</b> · Late days: <b className="text-ink">{data.summary.lateDays}</b></div>
      </div>

      <Table>
        <thead className="bg-subtle">
          <tr>
            <th className="th">Date</th>{team && <th className="th">Employee</th>}<th className="th">Check in</th><th className="th">Check out</th><th className="th">Worked</th><th className="th">Status</th><th className="th text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {!rows.length && <tr><td colSpan={cols} className="td text-center text-ink-muted">No records in this period.</td></tr>}
          {rows.map((r) => {
            const group = groupKey(r, by)
            const header = group && group !== lastGroup
            if (group) lastGroup = group
            const noRecord = !r.checkIn
            return [
              header && <tr key={`g${group}`} className="bg-subtle/60"><td colSpan={cols} className="px-4 py-1.5 text-xs font-bold">{group}</td></tr>,
              <tr key={r.id}>
                <td className="td whitespace-nowrap font-semibold">{fmtDay(r.date)}</td>
                {team && <td className="td whitespace-nowrap">{r.userName}</td>}
                {noRecord ? (
                  <td colSpan={3} className="td italic text-ink-muted">{r.status.key === 'leave' ? `${r.leave}: no attendance needed` : 'No attendance recorded · only HR can add a missed day'}</td>
                ) : (
                  <>
                    <td className="td">{r.checkInLocal}</td>
                    <td className="td">{r.checkOutLocal || '—'}</td>
                    <td className="td font-semibold">{r.checkOut ? hm(r.workedHours) : 'running'}</td>
                  </>
                )}
                <td className="td"><StatusPill status={r.status.key}>{r.status.label}</StatusPill></td>
                <td className="td text-right">
                  {r.status.key === 'in_progress' && <span className="text-xs text-ink-muted">Running · check out to close</span>}
                  {!noRecord && r.checkOut && !canEdit(r) && <span className="inline-flex items-center gap-1 text-xs text-ink-muted"><Lock size={12} />Period locked</span>}
                  {!noRecord && r.checkOut && canEdit(r) && (r.userId === user.id || team) && (
                    <span className="inline-flex gap-1.5">
                      <button className="btn-outline btn-sm" onClick={() => setEditing(r)}><Pencil size={12} />Edit</button>
                      {isAdmin && can('attendance.delete') && <button className="btn-outline btn-sm" onClick={() => setRemoving(r)} aria-label="Remove record"><Trash2 size={12} /></button>}
                    </span>
                  )}
                  {r.status.key === 'absent' && !team && (
                    r.missedRequest ? <span className="text-xs text-ink-muted">HR asked ({r.missedRequest.toLowerCase()})</span> : <button className="btn-outline btn-sm" onClick={() => setAsking(r)}>Ask HR to add</button>
                  )}
                </td>
              </tr>,
            ]
          })}
        </tbody>
      </Table>

      {!team && (
        <Card title="Edit history" className="mt-4">
          {!edits?.edits.length && <Empty>No edits yet.</Empty>}
          <div className="divide-y divide-line">
            {edits?.edits.map((e) => (
              <div key={e.id} className="flex flex-wrap justify-between gap-2 py-2 text-[13px]">
                <span><b>{e.editorName}</b> <span className="text-ink-soft">{fmtDay(e.date)} · {e.field} {e.oldValue ? `${e.oldValue} → ` : ''}{e.newValue} · "{e.reason}"</span></span>
                <span className="text-xs text-ink-muted">{fmtDateTime(e.editedAt)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {editing && <EditModal row={editing} onClose={() => setEditing(null)} onSaved={saved} />}
      {adding && <AddRecordModal onClose={() => setAdding(false)} onSaved={saved} />}
      {asking && <ReasonModal title={`Ask HR to add ${fmtDay(asking.date)}`} label="What happened?" confirm="Send to HR" onClose={() => setAsking(null)} onConfirm={ask} />}
      {removing && <ReasonModal title="Remove this record" confirm="Remove" danger onClose={() => setRemoving(null)} onConfirm={remove} />}
    </>
  )
}
