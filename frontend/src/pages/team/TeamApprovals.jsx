import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Paperclip } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../../contexts/AuthContext'
import { useFetch } from '../../components/hooks'
import { Avatar, Card, Empty, Kpi, Modal, PageError, PageHeader, PageLoader, Pill, ReasonModal } from '../../components/ui'
import { BoardPill, boardLine } from '../dashboards/parts'
import { AddRecordModal } from '../Attendance'
import { addDays, companyToday, fmtDay, fmtRange, hm, isoWeek } from '../../utils/format'
import api, { download, errorMessage } from '../../services/api'

function TeamCalendar() {
  const [month, setMonth] = useState(companyToday().slice(0, 7))
  const { data } = useFetch(`/leave/team-calendar?month=${month}`)
  const days = useMemo(() => {
    if (!data) return []
    const out = []
    for (let d = data.from; d <= data.to; d = addDays(d, 1)) out.push(d)
    return out
  }, [data])
  const people = useMemo(() => {
    const map = new Map()
    data?.entries.forEach((e) => map.set(e.userId, { name: e.userName, entries: [...(map.get(e.userId)?.entries || []), e] }))
    return [...map.values()]
  }, [data])
  const change = (n) => {
    const d = new Date(`${month}-15T12:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() + n)
    setMonth(d.toISOString().slice(0, 7))
  }
  const cols = { gridTemplateColumns: `140px repeat(${days.length}, minmax(20px, 1fr))` }
  return (
    <Card
      title={`Team calendar · ${fmtDay(`${month}-15`, 'MMMM yyyy')}`} className="mt-4"
      action={<div className="flex items-center gap-2"><span className="hidden text-xs text-ink-muted sm:inline">Solid = approved · light = pending</span><button className="btn-outline btn-sm" onClick={() => change(-1)}>Prev</button><button className="btn-outline btn-sm" onClick={() => change(1)}>Next</button></div>}
    >
      {!people.length && <Empty>Nobody is on leave this month.</Empty>}
      {people.length > 0 && (
        <div className="overflow-x-auto">
          <div className="grid min-w-[760px] gap-y-1" style={cols}>
            <div />
            {days.map((d) => <div key={d} className={`text-center text-[10px] ${[0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay()) ? 'text-ink-muted/60' : 'text-ink-muted'}`}>{Number(d.slice(8))}</div>)}
            {people.map((p) => [
              <div key={p.name} className="truncate pr-2 text-[13px] font-medium">{p.name}</div>,
              ...days.map((d) => {
                const e = p.entries.find((x) => x.dateFrom <= d && x.dateTo >= d)
                return <div key={`${p.name}${d}`} className="h-5" title={e ? `${e.leaveType.name}${e.state === 'APPROVED' ? '' : ' (pending)'}` : undefined} style={e ? { background: e.leaveType.colour, opacity: e.state === 'APPROVED' ? 1 : 0.4 } : undefined} />
              }),
            ])}
          </div>
        </div>
      )}
    </Card>
  )
}

function PersonModal({ person, onClose }) {
  const today = companyToday()
  const { data } = useFetch(`/attendance?scope=team&userId=${person.id}&from=${addDays(today, -13)}&to=${today}`)
  const { data: balances } = useFetch(`/leave/balances?userId=${person.id}`)
  return (
    <Modal title={person.name} wide onClose={onClose}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-1 text-[13px] font-bold">Last 2 weeks</h3>
          <div className="max-h-64 divide-y divide-line overflow-y-auto">
            {data?.items.map((r) => <div key={r.id} className="flex justify-between gap-2 py-1.5 text-[13px]"><span>{fmtDay(r.date)}</span><span className="text-ink-soft">{r.checkIn ? `${r.checkInLocal}–${r.checkOutLocal || 'now'}` : r.status.label}</span></div>)}
          </div>
        </div>
        <div>
          <h3 className="mb-1 text-[13px] font-bold">Leave balances</h3>
          {balances?.balances.filter((b) => b.requiresAllocation).map((b) => <div key={b.leaveTypeId} className="flex justify-between py-1 text-[13px]"><span>{b.name}</span><b>{b.available} days</b></div>)}
        </div>
      </div>
    </Modal>
  )
}

// Finished items a Manager or HR can reopen (BR-05).
function Reopen() {
  const { data, reload } = useFetch('/approvals/recent')
  const [reason, setReason] = useState(null)
  if (!data || (!data.timesheets.length && !data.leave.length)) return null
  const run = async () => {
    try {
      await reason.run()
      toast.success('Reset to draft')
      setReason(null)
      reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  return (
    <Card title="Validated and approved" className="mt-4" action={<span className="text-xs text-ink-muted">Reset to draft to correct something</span>}>
      <div className="grid gap-x-6 sm:grid-cols-2">
        <div>
          <div className="eyebrow mb-1">Timesheets</div>
          <div className="max-h-52 divide-y divide-line overflow-y-auto">
            {data.timesheets.map((t) => (
              <div key={`${t.userId}${t.week}`} className="flex items-center justify-between gap-2 py-1.5 text-[13px]">
                <span className="truncate">{t.name} · wk {isoWeek(t.week)} · {hm(t.hours)}</span>
                <button className="btn-outline btn-sm" onClick={() => setReason({ label: `${t.name}'s week ${isoWeek(t.week)}`, run: () => api.post('/timesheets/reset', { userId: t.userId, week: t.week }) })}>Reset</button>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="eyebrow mb-1">Approved leave</div>
          {!data.leave.length && <Empty>No current or upcoming leave.</Empty>}
          <div className="max-h-52 divide-y divide-line overflow-y-auto">
            {data.leave.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 py-1.5 text-[13px]">
                <span className="truncate">{l.name} · {l.type} · {fmtRange(l.from, l.to)}</span>
                <button className="btn-outline btn-sm" onClick={() => setReason({ label: `${l.name}'s leave`, run: () => api.post(`/leave/requests/${l.id}/reset`) })}>Reset</button>
              </div>
            ))}
          </div>
        </div>
      </div>
      {reason && (
        <Modal title="Reset to draft" onClose={() => setReason(null)}>
          <p className="text-[13px]">Reopen {reason.label}? The employee can edit it again and it must be approved again.</p>
          <div className="mt-3 flex justify-end gap-2"><button className="btn-outline" onClick={() => setReason(null)}>Cancel</button><button className="btn-danger" onClick={run}>Reset to draft</button></div>
        </Modal>
      )}
    </Card>
  )
}

export default function TeamApprovals() {
  const { user, isAdmin, can } = useAuth()
  const { data: dash, error, reload: reloadDash } = useFetch(isAdmin || !can('reports.view') ? null : '/dashboard/team')
  const { data: inbox, reload: reloadInbox, error: inboxError } = useFetch('/approvals')
  const [refusing, setRefusing] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [adding, setAdding] = useState(null)
  if (error || inboxError) return <PageError message={error || inboxError} onRetry={reloadInbox} />
  if (!inbox || (!isAdmin && can('reports.view') && !dash)) return <PageLoader />

  const again = () => { reloadInbox(); if (dash) reloadDash() }
  const act = (fn, ok) => async () => {
    try {
      await fn()
      if (ok) toast.success(ok)
      again()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const refuse = async (reason) => {
    try {
      await refusing.run(reason)
      setRefusing(null)
      again()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const step = isAdmin ? 'All steps, can override' : 'Waiting for you'
  const c = dash?.counts
  const openFile = (id) => download(`/files/${id}`, 'document').catch((e) => toast.error(errorMessage(e)))
  const Item = ({ who, tag, tone, title, sub, warn, children }) => (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <Avatar name={who} size={34} />
      <div className="min-w-[220px] flex-1">
        <div className="text-[13px] font-semibold">{title}</div>
        <div className="text-xs text-ink-soft">{sub}</div>
        {warn && <div className="text-xs text-brand-ink">{warn}</div>}
      </div>
      <Pill tone={tone}>{tag}</Pill>
      <div className="flex gap-2">{children}</div>
    </div>
  )
  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle={dash ? `${user.department?.name || ''} · ${dash.headcount} people · ${inbox.total} waiting` : `${inbox.total} waiting`}
      />
      {dash && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi label="Checked in now" value={`${c.in} / ${dash.headcount}`} />
          <Kpi label="Late today" value={c.late} tone={c.late ? 'warn' : undefined} />
          <Kpi label="On leave" value={c.leave} tone={c.leave ? 'info' : undefined} />
          <Kpi label="Absent" value={c.absent} tone={c.absent ? 'bad' : undefined} />
          <Kpi label="Waiting for you" value={inbox.total} tone={inbox.total ? 'brand' : undefined} />
        </div>
      )}
      <div className={`mt-4 grid gap-4 ${dash ? 'lg:grid-cols-[1fr_1.5fr]' : ''}`}>
        {dash && (
          <Card title="Crew board · today" action={<span className="text-xs text-ink-muted">Live</span>}>
            <div className="max-h-[480px] divide-y divide-line overflow-y-auto">
              {dash.board.map((b) => (
                <button key={b.id} onClick={() => setViewing(b)} className="flex w-full items-center gap-2.5 py-2 text-left hover:bg-subtle/50">
                  <Avatar name={b.name} size={32} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold">{b.name}</span><span className="block truncate text-xs text-ink-muted">{boardLine(b)}</span></span>
                  <BoardPill b={b} />
                </button>
              ))}
            </div>
          </Card>
        )}
        <Card title="Approval inbox" action={<span className="text-xs text-ink-muted">{step}</span>}>
          {!inbox.total && <Empty>You're all caught up.</Empty>}
          <div className="divide-y divide-line">
            {inbox.leave.map((r) => (
              <Item
                key={`l${r.id}`} who={r.userName} tag="Leave" tone="brand" title={`${r.userName} · ${r.leaveType.name} · ${r.days} day${r.days === 1 ? '' : 's'}`}
                sub={`${fmtRange(r.dateFrom, r.dateTo)}${r.balanceAfter !== null ? ` · ${r.balanceAfter} days left after this` : ''}${r.state === 'PARTLY_APPROVED' ? ` · approved by ${r.step1By || 'manager'}` : ''}${r.reason ? ` · ${r.reason}` : ''}`}
                warn={r.conflicts.length ? `Overlaps: ${r.conflicts.map((x) => `${x.name}${x.pending ? ' (pending)' : ''} ${fmtDay(x.from, 'd')}–${fmtDay(x.to, 'd MMM')}`).join(', ')}` : null}
              >
                {r.attachmentId && <button className="btn-outline btn-sm" onClick={() => openFile(r.attachmentId)} aria-label="Open document"><Paperclip size={12} /></button>}
                <button className="btn-outline btn-sm" onClick={() => setRefusing({ title: `Refuse ${r.userName}'s leave`, run: (reason) => api.post(`/leave/requests/${r.id}/refuse`, { reason }) })}>Refuse</button>
                <button className="btn-primary btn-sm" onClick={act(() => api.post(`/leave/requests/${r.id}/approve`, {}), 'Approved')}>Approve</button>
              </Item>
            ))}
            {inbox.timesheets.map((t) => (
              <Item
                key={`t${t.userId}${t.week}`} who={t.name} tag="Timesheet" tone="ok" title={`${t.name} · Timesheet week ${isoWeek(t.week)}`}
                sub={`${hm(t.hours)} logged · ${hm(t.attended)} attended${t.state === 'PARTLY_VALIDATED' ? ' · passed the first step' : ''}`}
                warn={t.attended - t.hours > 0.5 ? `${hm(t.attended - t.hours)} attended but not logged` : null}
              >
                <button className="btn-primary btn-sm" onClick={act(() => api.post('/timesheets/validate', { userId: t.userId, week: t.week }), 'Validated')}>Validate</button>
              </Item>
            ))}
            {inbox.autoCheckouts.map((a) => (
              <Item key={`a${a.id}`} who={a.name} tag="Attendance" tone="warn" title={`${a.name} · Auto checked-out record`} sub={`${fmtDay(a.date)} · ${a.checkIn} → ${a.checkOut} (system close)`} warn="Ask them to correct it, or edit the time yourself">
                <Link to="/attendance" className="btn-outline btn-sm">Edit</Link>
                <button className="btn-primary btn-sm" onClick={act(() => api.post(`/attendance/${a.id}/review`), 'Marked as reviewed')}>Keep as is</button>
              </Item>
            ))}
            {inbox.missedDays.map((m) => (
              <Item key={`m${m.id}`} who={m.name} tag="Missed day" tone="info" title={`${m.name} · Add a missed day`} sub={`${fmtDay(m.date)} · ${m.note}`}>
                <button className="btn-outline btn-sm" onClick={() => setRefusing({ title: `Refuse ${m.name}'s request`, run: (reason) => api.post(`/attendance/missed-day/${m.id}/refuse`, { reason }) })}>Refuse</button>
                <button className="btn-primary btn-sm" onClick={() => setAdding(m)}>Add record</button>
              </Item>
            ))}
            {inbox.changeRequests > 0 && (
              <Item who="Profile" tag="Profile" tone="neutral" title={`${inbox.changeRequests} profile change request${inbox.changeRequests === 1 ? '' : 's'}`} sub="Reviewed under Change Requests">
                <Link to="/hr/requests" className="btn-outline btn-sm">Open</Link>
              </Item>
            )}
          </div>
        </Card>
      </div>
      <Reopen />
      <TeamCalendar />
      {refusing && <ReasonModal title={refusing.title} confirm="Refuse" danger onClose={() => setRefusing(null)} onConfirm={refuse} />}
      {viewing && <PersonModal person={viewing} onClose={() => setViewing(null)} />}
      {adding && <AddRecordModal prefill={adding} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); again() }} />}
    </>
  )
}
