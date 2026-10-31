import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, Gift, LogIn, LogOut, Video } from 'lucide-react'
import toast from 'react-hot-toast'
import { useLive } from '../../contexts/LiveContext'
import { useFetch, useInterval } from '../../components/hooks'
import { Card, Empty, LinkArrow, Pill } from '../../components/ui'
import { clock, fmtRange, fmtTime, hm, ago } from '../../utils/format'
import api, { errorMessage } from '../../services/api'

export const useTick = (active) => {
  const [, set] = useState(0)
  useInterval(() => set((n) => n + 1), active ? 1000 : null)
}

// The live counter is always derived from the stored check-in and the server clock (ATT-02).
export function useElapsed() {
  const { attendance, serverNow } = useLive()
  useTick(attendance?.checkedIn)
  if (!attendance) return { seconds: 0, todaySeconds: 0, attendance: null }
  const running = attendance.checkedIn ? (serverNow() - new Date(attendance.openSince).getTime()) / 1000 : 0
  return { seconds: running, todaySeconds: attendance.closedHoursToday * 3600 + running, attendance }
}

export function AttendanceCard({ shift }) {
  const { punch, busy } = useLive()
  const { seconds, todaySeconds, attendance } = useElapsed()
  if (!attendance) return <Card className="min-h-[200px]" />
  const on = attendance.checkedIn
  return (
    <Card>
      <div className="grid gap-5 md:grid-cols-[1fr_1fr]">
        <div>
          <div className="flex items-center gap-2">
            <Clock size={16} /><h2 className="text-[15px] font-bold">Attendance</h2>
            <Pill tone={on ? 'ok' : 'neutral'}>{on ? 'Checked in' : 'Checked out'}</Pill>
          </div>
          <div className="mt-3 text-5xl font-extrabold tracking-tight tabular-nums" aria-live="off">{clock(seconds)}</div>
          <p className="mt-2 text-[13px] text-ink-soft">{on ? `Since ${fmtTime(attendance.openSince)}. Today's total: ${clock(todaySeconds)}.` : 'Not checked in. Click Check In to start the counter.'}</p>
          <button onClick={punch} disabled={busy} className={`mt-3 ${on ? 'btn-danger' : 'btn-primary'} !px-5 !py-2.5`}>
            {on ? <LogOut size={16} /> : <LogIn size={16} />}{on ? 'Check Out' : 'Check In'}
          </button>
        </div>
        <div className="md:border-l md:border-line md:pl-5">
          <div className="flex justify-between text-[13px] font-semibold"><span>Today's records</span><span>Total {hm(todaySeconds / 3600)}</span></div>
          <div className="mt-2 space-y-1.5">
            {attendance.records.length === 0 && <Empty>No records yet today.</Empty>}
            {attendance.records.map((r) => (
              <div key={r.id} className="flex justify-between rounded-lg bg-subtle px-3 py-1.5 text-[13px]">
                <span>{r.checkIn} → {r.checkOut || 'now'}</span><span className="font-semibold">{r.checkOut ? hm(r.workedHours) : 'running'}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-muted">Time comes from the server clock. Forgot to check out? The record closes automatically{shift ? ` 4 hours after ${shift.end}` : ''} and is flagged for review.</p>
          <div className="mt-1"><LinkArrow to="/attendance">View my attendance</LinkArrow></div>
        </div>
      </div>
    </Card>
  )
}

// The compact strip on leader dashboards.
export function CheckBar({ name }) {
  const { punch, busy } = useLive()
  const { seconds, todaySeconds, attendance } = useElapsed()
  if (!attendance) return null
  const on = attendance.checkedIn
  return (
    <div className="card mb-4 flex flex-wrap items-center gap-3 !py-3">
      <Clock size={20} className={on ? 'text-ok' : 'text-ink-muted'} />
      <div className="min-w-[170px] flex-1">
        <div className="text-[13px] font-semibold">{on ? `You are checked in · ${name}` : `You are checked out · ${name}`}</div>
        <div className="text-xs text-ink-muted">{on ? `Since ${fmtTime(attendance.openSince)} · today ${hm(todaySeconds / 3600)}` : `Today ${hm(todaySeconds / 3600)}`}</div>
      </div>
      <div className="text-2xl font-extrabold tabular-nums">{clock(seconds)}</div>
      <button onClick={punch} disabled={busy} className={on ? 'btn-danger' : 'btn-primary'}>{on ? 'Check Out' : 'Check In'}</button>
    </div>
  )
}

export function MeetingsCard() {
  const { data } = useFetch('/calendar/today')
  const meetings = data?.meetings || []
  const until = (m) => {
    const mins = Math.round((new Date(m.start) - Date.now()) / 60000)
    if (mins <= 0) return 'Now'
    return mins < 90 ? `In ${mins} min` : null
  }
  return (
    <Card title="Today's meetings" action={<LinkArrow to="/calendar">Calendar</LinkArrow>}>
      {!meetings.length && <Empty>Nothing else scheduled today.</Empty>}
      <div className="divide-y divide-line">
        {meetings.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold">{m.title}</div>
              <div className="truncate text-xs text-ink-muted">{fmtTime(m.start)}–{fmtTime(m.end)}{m.location ? ` · ${m.location}` : ''}</div>
            </div>
            {m.meetingUrl
              ? <a href={m.meetingUrl} target="_blank" rel="noreferrer" className="btn-outline btn-sm"><Video size={13} />Join</a>
              : until(m) && <Pill tone="brand">{until(m)}</Pill>}
          </div>
        ))}
      </div>
      {data?.syncedFrom && <p className="mt-2 text-[11px] text-ink-muted">Synced from {data.syncedFrom.accountEmail}{data.syncedFrom.lastSyncAt ? ` · ${ago(data.syncedFrom.lastSyncAt)}` : ''}</p>}
    </Card>
  )
}

export function BirthdayCard() {
  const { data, reload } = useFetch('/people/celebrations')
  const { data: wishes } = useFetch('/people/wishes')
  if (!data) return <Card title="Birthdays" />
  const first = data.today[0]
  const next = data.upcoming[0]
  const send = async (id) => {
    try {
      await api.post(`/people/${id}/wish`, {})
      toast.success('Wishes sent')
      reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  return (
    <Card title="Birthdays" className="!bg-brand-soft !border-brand/20">
      {first ? (
        <>
          <p className="text-[13px]"><b>{first.name}</b> has a birthday today.</p>
          <button className="btn-primary mt-2" disabled={first.wished} onClick={() => send(first.id)}><Gift size={14} />{first.wished ? 'Wishes sent' : 'Send wishes'}</button>
        </>
      ) : <p className="text-[13px] text-ink-soft">No birthdays today.</p>}
      {next && <p className="mt-2 text-xs text-ink-soft">Next: {next.name} · {fmtRange(next.on, next.on)}</p>}
      {wishes?.wishes.length > 0 && <p className="mt-2 text-xs font-semibold text-brand-ink">{wishes.wishes.length} {wishes.wishes.length === 1 ? 'person' : 'people'} wished you this year</p>}
    </Card>
  )
}

export function Announcements({ items }) {
  return (
    <Card title="Announcements" action={<LinkArrow to="/chat">Open chat</LinkArrow>}>
      {!items.length && <Empty>No announcements.</Empty>}
      <div className="divide-y divide-line">
        {items.map((a) => (
          <div key={a.id} className="py-2">
            <div className="text-[13px] font-semibold">{a.body}</div>
            <div className="text-xs text-ink-muted">{a.sender} · {ago(a.at)}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

export const BOARD_PILL = {
  in: ['ok', 'Checked in'], late: ['warn', 'Late'], leave: ['info', 'On leave'], absent: ['bad', 'Absent'], out: ['neutral', 'Checked out'], not_yet: ['neutral', 'Not yet in'], off: ['neutral', 'Day off'],
}

export function boardLine(b) {
  if (b.status === 'leave') return `${b.leaveType}, back after ${b.until}`
  if (b.status === 'absent') return `Scheduled ${b.shift?.start} · no check-in, no leave`
  if (b.status === 'not_yet') return `Scheduled ${b.shift?.start}`
  if (b.status === 'off') return 'Not scheduled today'
  return b.checkIn ? `In at ${fmtTime(b.checkIn)}` : ''
}

export function BoardPill({ b }) {
  const [tone, label] = BOARD_PILL[b.status]
  return <Pill tone={tone}>{b.status === 'late' ? `Late ${b.lateMinutes} min` : label}</Pill>
}

export function InboxLink({ count, label }) {
  const navigate = useNavigate()
  return <button className="link" onClick={() => navigate('/team')}>{label}{count ? ` (${count})` : ''}</button>
}

