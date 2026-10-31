import { useEffect } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Download, Plus, UserPlus } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../../contexts/AuthContext'
import { useFetch } from '../../components/hooks'
import { Avatar, Bar, Card, Empty, Kpi, LinkArrow, PageError, PageHeader, PageLoader, Pill, StatusPill } from '../../components/ui'
import { AttendanceCard, Announcements, BirthdayCard, CheckBar, MeetingsCard } from './parts'
import { addDays, ago, companyToday, fmtDay, fmtLong, fmtRange, greeting, hm, isoWeek, mondayOf } from '../../utils/format'
import api, { download, errorMessage } from '../../services/api'

const COLOURS = ['rgb(var(--brand-bright))', 'rgb(var(--teal))', 'rgb(var(--info))', 'rgb(var(--ink-muted))', 'rgb(var(--violet))']

const firstName = (user) => user.preferredName || user.name.split(' ')[0]

function WeekCard() {
  const { data, reload } = useFetch('/attendance/summary')
  useEffect(() => {
    window.addEventListener('attendance:changed', reload)
    return () => window.removeEventListener('attendance:changed', reload)
  }, [reload])
  if (!data) return <Card title="This week" />
  const max = Math.max(9, ...data.week.map((d) => d.hours))
  const today = companyToday()
  return (
    <Card title="This week">
      <div className="flex h-24 items-end gap-2">
        {data.week.slice(0, 5).map((d) => (
          <div key={d.date} className="flex h-full flex-1 flex-col justify-end">
            <div className="rounded-md" style={{ height: `${(d.hours / max) * 100}%`, minHeight: 3, background: d.date === today ? 'rgb(var(--brand-bright) / .4)' : 'rgb(var(--brand-bright))' }} title={hm(d.hours)} />
            <div className={`mt-1 text-center text-[11px] ${d.date === today ? 'font-bold' : 'text-ink-muted'}`}>{fmtDay(d.date, 'EEE')}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-between text-[13px]"><span className="text-ink-soft">Worked</span><b>{hm(data.worked)} / {data.scheduled}h</b></div>
      <div className="mt-1 flex justify-between text-[13px]"><span className="text-ink-soft">Extra hours (month)</span><b className={data.monthExtra >= 0 ? 'text-ok' : 'text-bad'}>{data.monthExtra >= 0 ? '+' : ''}{hm(data.monthExtra)}</b></div>
    </Card>
  )
}

function MyPanels({ me }) {
  const { can } = useAuth()
  const unlogged = Math.max(0, me.timesheet.attended - me.timesheet.logged)
  return (
    <>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Leave balances" action={<LinkArrow to="/leave">Apply</LinkArrow>}>
          <div className="space-y-3">
            {me.balances.filter((b) => b.requiresAllocation).slice(0, 3).map((b) => (
              <div key={b.leaveTypeId}>
                <div className="mb-1 flex justify-between text-[13px]"><span>{b.name}</span><b>{b.available} of {b.allocated} days</b></div>
                <Bar value={b.available} max={b.allocated} color={b.colour} />
              </div>
            ))}
          </div>
        </Card>
        {can('module.timesheets') && <Card title="Timesheet this week" action={<LinkArrow to="/timesheets">Open grid</LinkArrow>}>
          <div className="text-[13px] text-ink-soft"><span className="text-2xl font-bold text-ink">{hm(me.timesheet.logged)}</span> logged of {hm(me.timesheet.attended)} attended</div>
          <div className="mt-2 divide-y divide-line">
            {me.timesheet.rows.slice(0, 3).map((r) => <div key={`${r.project}${r.task}`} className="flex justify-between py-1.5 text-[13px]"><span className="truncate">{r.project} · {r.task}</span><b>{hm(r.hours)}</b></div>)}
          </div>
          {unlogged > 0.25 && <p className="mt-2 rounded-lg bg-brand-soft px-3 py-2 text-xs text-brand-ink">{hm(unlogged)} attended but not logged. Log it before Friday 15:00.</p>}
        </Card>}
        <Card title="My requests">
          {!me.requests.length && <Empty>No requests yet.</Empty>}
          <div className="divide-y divide-line">
            {me.requests.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0"><div className="truncate text-[13px] font-semibold">{r.title}</div><div className="text-xs text-ink-muted">{fmtRange(r.from, r.to)}</div></div>
                <StatusPill status={r.state}>{r.label}</StatusPill>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <MeetingsCard />
        <BirthdayCard />
        <Announcements items={me.announcements} />
      </div>
    </>
  )
}

function EmployeeDashboard({ user }) {
  const { data: me, error, reload } = useFetch('/dashboard/me')
  const { data: summary } = useFetch('/attendance/summary')
  const navigate = useNavigate()
  if (error) return <PageError message={error} onRetry={reload} />
  if (!me) return <PageLoader />
  return (
    <>
      <PageHeader title={`${greeting()}, ${firstName(user)}`} subtitle={`${fmtLong(companyToday())}${summary?.shift ? ` · Schedule ${summary.shift.start}–${summary.shift.end}` : ''}`}>
        <button className="btn-outline" onClick={() => navigate('/leave')}><Plus size={14} />Apply for leave</button>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><AttendanceCard shift={summary?.shift} /></div>
        <WeekCard />
      </div>
      <MyPanels me={me} />
    </>
  )
}

function Approvals({ team, title }) {
  const items = [
    ...team.leaveInbox.map((r) => ({ id: `l${r.id}`, title: `${r.userName} · ${r.leaveType.name} ${r.days} day${r.days === 1 ? '' : 's'}`, sub: `${fmtRange(r.dateFrom, r.dateTo)}${r.conflicts.length ? ` · overlaps ${r.conflicts[0].name}` : ''}` })),
    ...team.timesheetInbox.map((t) => ({ id: `t${t.userId}${t.week}`, title: `${t.name} · Timesheet wk ${isoWeek(t.week)}`, sub: `${hm(t.hours)} logged · ${hm(t.attended)} attended` })),
  ]
  return (
    <Card title={title} action={<LinkArrow to="/team">Open inbox</LinkArrow>}>
      {!items.length && <Empty>You're all caught up.</Empty>}
      <div className="divide-y divide-line">
        {items.slice(0, 5).map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0"><div className="truncate text-[13px] font-semibold">{i.title}</div><div className="truncate text-xs text-ink-muted">{i.sub}</div></div>
            <Link to="/team" className="btn-outline btn-sm">Review</Link>
          </div>
        ))}
      </div>
    </Card>
  )
}

function ManagerDashboard({ user }) {
  const { data: team, error, reload } = useFetch('/dashboard/team')
  if (error) return <PageError message={error} onRetry={reload} />
  if (!team) return <PageLoader />
  const c = team.counts
  const week = mondayOf(companyToday())
  const trend = team.attendanceTrend
  const current = trend[trend.length - 1]?.rate
  const previous = trend[trend.length - 2]?.rate
  const maxProject = Math.max(1, ...team.projects.map((p) => p.hours))
  const peak = team.cover.reduce((m, d) => (d.count > m.count ? d : m), { count: 0 })
  const waiting = team.leaveInbox.length + team.timesheetInbox.length
  return (
    <>
      <PageHeader title={`${user.department?.name || 'Team'} overview`} subtitle={`Manager · ${team.headcount} people · week ${isoWeek(week)}, ${fmtRange(week, addDays(week, 6))}`}>
        <button className="btn-outline" onClick={() => download('/reports/attendance?format=xlsx', 'attendance.xlsx').catch((e) => toast.error(errorMessage(e)))}><Download size={14} />Export</button>
      </PageHeader>
      <CheckBar name={user.name} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Attendance rate" value={current === null || current === undefined ? '—' : `${current}%`} sub={previous !== null && previous !== undefined && current !== null ? `${current - previous >= 0 ? '+' : ''}${current - previous} pts vs last week` : ''} />
        <Kpi label="Checked in now" value={`${c.in} / ${team.headcount}`} sub={`${c.leave} on leave, ${c.absent} absent`} />
        <Kpi label="Overtime this week" value={hm(team.overtimeTotal)} sub={`${team.overtime.length} people`} tone={team.overtimeTotal ? 'warn' : undefined} />
        <Kpi label="Unlogged hours" value={hm(team.unlogged)} sub="Attended, no timesheet" tone={team.unlogged > 1 ? 'bad' : undefined} />
        <Kpi label="Final approvals" value={waiting} sub={`${team.leaveInbox.length} leave, ${team.timesheetInbox.length} timesheet`} tone={waiting ? 'brand' : undefined} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Attendance rate · last 6 weeks">
          <div className="flex h-36 items-end gap-2">
            {trend.map((t, i) => (
              <div key={t.week} className="flex h-full flex-1 flex-col justify-end text-center">
                <div className="mb-1 text-[11px] font-semibold">{t.rate === null ? '—' : `${t.rate}%`}</div>
                <div className="rounded-md" style={{ height: `${(t.rate || 0) * 0.8}%`, background: i === trend.length - 1 ? 'rgb(var(--brand-bright))' : 'rgb(var(--brand-bright) / .35)' }} />
                <div className="mt-1 text-[11px] text-ink-muted">wk {isoWeek(t.week)}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-muted">Share of scheduled days with a check-in or approved leave.</p>
        </Card>
        <Card title="Hours by project · this week">
          {!team.projects.length && <Empty>No hours logged yet this week.</Empty>}
          <div className="space-y-3">
            {team.projects.map((p, i) => (
              <div key={p.name}>
                <div className="mb-1 flex justify-between text-[13px]"><span className="truncate">{p.name}</span><b>{Math.round(p.hours)}h</b></div>
                <Bar value={p.hours} max={maxProject} color={COLOURS[i % COLOURS.length]} />
              </div>
            ))}
          </div>
        </Card>
        <Approvals team={team} title="Waiting for your final approval" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Overtime & exceptions">
          <div className="divide-y divide-line">
            {team.overtime.slice(0, 3).map((o) => <div key={o.name} className="flex justify-between gap-2 py-1.5 text-[13px]"><span className="truncate">{o.name}</span><Pill tone="warn">+{hm(o.hours)} overtime</Pill></div>)}
            {team.lateRepeat.slice(0, 2).map((o) => <div key={o.name} className="flex justify-between gap-2 py-1.5 text-[13px]"><span className="truncate">{o.name}</span><Pill tone="warn">Late {o.times} times this month</Pill></div>)}
            {team.missingCheckouts.slice(0, 2).map((m) => <div key={m.id} className="flex justify-between gap-2 py-1.5 text-[13px]"><span className="truncate">{m.name}</span><Pill tone="bad">Auto check-out</Pill></div>)}
            {team.board.filter((b) => b.status === 'absent').slice(0, 2).map((b) => <div key={b.id} className="flex justify-between gap-2 py-1.5 text-[13px]"><span className="truncate">{b.name}</span><Pill tone="bad">Absent, no leave</Pill></div>)}
          </div>
          {!team.overtime.length && !team.lateRepeat.length && !team.missingCheckouts.length && <Empty>Nothing unusual.</Empty>}
        </Card>
        <div className="lg:col-span-2">
          <Card title="Leave cover · next 2 weeks" action={<span className="text-xs text-ink-muted">People away per day (of {team.headcount})</span>}>
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">
              {team.cover.map((d) => (
                <div key={d.date} className="text-center">
                  <div className="rounded-lg py-2.5 text-[15px] font-bold" style={{ background: d.count === 0 ? 'rgb(var(--subtle))' : `rgb(var(--brand-bright) / ${Math.min(0.2 + d.count * 0.2, 1)})` }}>{d.count}</div>
                  <div className="mt-1 text-[11px] text-ink-muted">{fmtDay(d.date, 'EEE d')}</div>
                </div>
              ))}
            </div>
            {peak.count >= 2 && <p className="mt-2 text-xs text-brand-ink">{fmtDay(peak.date, 'EEE d MMM')}: {peak.count} people away.</p>}
          </Card>
        </div>
      </div>
    </>
  )
}

function HRDashboard({ user }) {
  const { data, error, reload } = useFetch('/dashboard/hr')
  const navigate = useNavigate()
  if (error) return <PageError message={error} onRetry={reload} />
  if (!data) return <PageLoader />
  const act = (fn, ok) => async () => {
    try {
      await fn()
      if (ok) toast.success(ok)
      reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const maxDept = Math.max(1, ...data.departments.map((d) => d.count))
  const leaveLine = Object.entries(data.leaveToday.byType).map(([k, v]) => `${v} ${k.replace(' leave', '').toLowerCase()}`).join(', ') || 'None today'
  const INVITE = { SENT: 'Sent · not opened', OPENED: 'Opened', EXPIRED: 'Expired', BOUNCED: 'Bounced', ACTIVATED: 'Activated' }
  return (
    <>
      <PageHeader title="HR overview" subtitle={`${user.name} · ${user.roleName} · whole company (${data.active} people)`}>
        <button className="btn-primary" onClick={() => navigate('/hr/employees?new=1')}><UserPlus size={14} />Add employee</button>
      </PageHeader>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Active employees" value={data.active} sub={`+${data.joinedThisMonth} this month`} />
        <Kpi label="Checked in now" value={data.counts.in} sub={`${Math.round((data.counts.in / Math.max(1, data.scheduled)) * 100)}% of scheduled`} />
        <Kpi label="On leave today" value={data.leaveToday.total} sub={leaveLine} />
        <Kpi label="Invites pending" value={data.invitesPending} sub="Not yet activated" tone={data.invitesPending ? 'brand' : undefined} />
        <Kpi label="Change requests" value={data.changeRequests} sub="From employees" tone={data.changeRequests ? 'brand' : undefined} />
        <Kpi label="Leave liability" value={`${Math.round(data.leaveLiability)} days`} sub="Unused annual leave" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Profile change notifications" action={<Pill tone="brand">{data.pendingRequests.length + data.profileChanges.length} open</Pill>}>
          {!data.pendingRequests.length && !data.profileChanges.length && <Empty>Nothing new.</Empty>}
          <div className="divide-y divide-line">
            {data.pendingRequests.map((r) => (
              <div key={`r${r.id}`} className="flex gap-2.5 py-2.5">
                <Avatar name={r.userName} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[13px]"><b>{r.userName}</b> changed {r.summary.map((s) => s.label.toLowerCase()).join(', ')}</div>
                    <Pill tone="warn">Needs approval</Pill>
                  </div>
                  <div className="text-xs text-ink-muted">{ago(r.createdAt)} · {r.summary.map((s) => `${s.oldMasked || 'empty'} → ${s.newMasked}`).join('; ')}</div>
                  <Link to="/hr/requests" className="btn-primary btn-sm mt-2">Review</Link>
                </div>
              </div>
            ))}
            {data.profileChanges.map((c) => (
              <div key={`c${c.id}`} className="flex gap-2.5 py-2.5">
                <Avatar name={c.userName} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[13px]"><b>{c.userName}</b> updated {c.field.toLowerCase()}</div>
                    <Pill tone="brand">New</Pill>
                  </div>
                  <div className="truncate text-xs text-ink-muted">{ago(c.createdAt)} · {c.oldValue || 'empty'} → {c.newValue || 'empty'}</div>
                  <button className="btn-outline btn-sm mt-2" onClick={act(() => api.post(`/profile/changes/${c.id}/seen`))}>Mark as seen</button>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Onboarding · welcome emails" action={<LinkArrow to="/hr/policies?tab=email">Preview email</LinkArrow>}>
          {!data.invites.length && <Empty>No invites waiting.</Empty>}
          <div className="divide-y divide-line">
            {data.invites.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0"><div className="truncate text-[13px] font-semibold">{i.name}</div><div className="truncate text-xs text-ink-muted">{i.email}{i.invitedAt ? ` · sent ${ago(i.invitedAt)}` : ''}</div></div>
                <StatusPill status={i.status}>{INVITE[i.status]}</StatusPill>
                <button className="btn-outline btn-sm" onClick={act(() => api.post(`/employees/${i.id}/resend-invite`, {}), 'New invite sent')}>Resend</button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-muted">Resend creates a new temporary password and cancels the old one.</p>
        </Card>
        <Card title="Headcount by department">
          <div className="space-y-2.5">
            {data.departments.map((d, i) => (
              <div key={d.name}>
                <div className="mb-1 flex justify-between text-[13px]"><span>{d.name}</span><b>{d.count}</b></div>
                <Bar value={d.count} max={maxDept} color={COLOURS[i % COLOURS.length]} />
              </div>
            ))}
          </div>
        </Card>
        <Card title="Attendance exceptions · this week">
          {[['Missing check-outs (auto-closed)', data.exceptions.autoClosed], ['Absent without leave today', data.exceptions.absentToday, true], ['Edited records', data.exceptions.edited]].map(([k, v, bad]) => (
            <div key={k} className="flex justify-between border-b border-line py-2 text-[13px]"><span>{k}</span><b className={bad && v ? 'text-bad' : ''}>{v}</b></div>
          ))}
          <div className="flex items-center justify-between py-2 text-[13px]"><span>Requests to add a missed day</span><span className="flex items-center gap-2"><b>{data.exceptions.missedDays}</b><Link to="/team" className="btn-outline btn-sm">Review</Link></span></div>
        </Card>
        <Card title="This week's celebrations">
          {!data.celebrations.length && <Empty>Nothing this week.</Empty>}
          <div className="divide-y divide-line">
            {data.celebrations.map((c) => <div key={c.id} className="flex justify-between py-2 text-[13px]"><span>{c.title}</span><span className="text-ink-soft">{c.on === companyToday() ? 'Today' : fmtDay(c.on)}</span></div>)}
          </div>
        </Card>
        <Card title="Compliance & documents">
          {[['Employees without emergency contact', data.compliance.noEmergency], ['Employees without a running contract', data.compliance.noContract], ['Probation reviews in the next 30 days', data.compliance.probation], ['Work permits expiring in 60 days', data.compliance.permits], ['Contracts ending in 30 days', data.compliance.contractsEnding], ['Sick notes outstanding', data.compliance.sickNotes]].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between border-b border-line py-2 text-[13px]"><span>{k}</span><Pill tone={v ? 'warn' : 'ok'}>{v}</Pill></div>
          ))}
        </Card>
      </div>
    </>
  )
}

export default function Home() {
  const { user, can } = useAuth()
  if (user.role === 'SUPER_ADMIN') return <Navigate to="/system/companies" replace />
  if (can('users.manage')) return <HRDashboard user={user} />
  if (user.role === 'MANAGER' && can('reports.view')) return <ManagerDashboard user={user} />
  return <EmployeeDashboard user={user} />
}
