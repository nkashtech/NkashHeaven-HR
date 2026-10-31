import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Download, KeyRound, SlidersHorizontal, TriangleAlert, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useFetch, useInterval } from '../../components/hooks'
import { Bar, Card, Empty, Kpi, Modal, PageError, PageHeader, PageLoader, Segmented, StatusPill } from '../../components/ui'
import { ago, bytes, fmtDateTime, fmtTime } from '../../utils/format'
import api, { errorMessage } from '../../services/api'

const ALERT_MS = 500
const STATUS_LABEL = { operational: 'Operational', degraded: 'Degraded', down: 'Down', off: 'Not configured' }
const DOT = { operational: 'bg-ok', degraded: 'bg-warn', down: 'bg-bad', off: 'bg-ink-muted' }

function ResponseChart({ series }) {
  const max = Math.max(ALERT_MS * 1.15, ...series.map((s) => s.p95))
  const line = (ALERT_MS / max) * 100
  return (
    <div>
      <div className="relative h-44">
        <div className="absolute inset-x-0 border-t border-dashed border-bad/60" style={{ bottom: `${line}%` }}><span className="absolute -top-4 right-0 text-[10px] font-semibold text-bad">{ALERT_MS} ms alert</span></div>
        <div className="flex h-full items-end gap-1.5">
          {series.map((s) => (
            <div key={s.at} className="flex-1 rounded-t" title={`${fmtDateTime(s.at)}: ${s.p95} ms, ${s.requests} requests`} style={{ height: `${Math.max(1, (s.p95 / max) * 100)}%`, background: s.p95 >= ALERT_MS ? 'rgb(var(--bad))' : 'rgb(var(--brand-bright))' }} />
          ))}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-ink-muted"><span>{fmtDateTime(series[0].at)}</span><span>now</span></div>
    </div>
  )
}

function LogsModal({ onClose }) {
  const { data } = useFetch('/system/logs')
  return (
    <Modal title="Logs" wide onClose={onClose}>
      <h3 className="text-[13px] font-bold">Errors</h3>
      {!data?.errors.length && <Empty>No errors logged.</Empty>}
      <div className="max-h-52 divide-y divide-line overflow-y-auto">
        {data?.errors.map((e) => <div key={e.id} className="py-1.5 text-xs"><b>{e.endpoint}</b> · {e.status} · ×{e.count} · {fmtDateTime(e.lastAt)}<div className="text-ink-soft">{e.message}</div></div>)}
      </div>
      <h3 className="mt-3 text-[13px] font-bold">Security events</h3>
      {!data?.security.length && <Empty>No events.</Empty>}
      <div className="max-h-52 divide-y divide-line overflow-y-auto">
        {data?.security.map((e) => <div key={e.id} className="py-1.5 text-xs"><b>{e.type}</b> · {e.email || `user ${e.userId || '?'}`} · {e.ip} · {fmtDateTime(e.at)}{e.detail ? ` · ${e.detail}` : ''}</div>)}
      </div>
    </Modal>
  )
}

export default function Health() {
  const [range, setRange] = useState('24h')
  const [logs, setLogs] = useState(false)
  const { data, error, reload } = useFetch(`/system/health?range=${range}`)
  useInterval(reload, 30000)
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
  const banner = {
    operational: ['bg-ok-soft text-ok border-ok/25', CheckCircle2, 'All systems operational'],
    degraded: ['bg-warn-soft text-warn border-warn/25', TriangleAlert, 'Some services need attention'],
    down: ['bg-bad-soft text-bad border-bad/25', XCircle, 'A service is down'],
  }[data.overall]
  const Icon = banner[1]
  const dbMax = 50 * 1073741824
  const uploadMax = 100 * 1073741824
  const row = (k, v, extra) => <div className="flex items-center justify-between border-b border-line py-2 text-[13px]"><span>{k}</span><span className="flex items-center gap-2"><b>{v}</b>{extra}</span></div>
  return (
    <>
      <PageHeader title="System health" subtitle="Super Admin · platform performance, security and usage">
        <Segmented value={range} onChange={setRange} options={[['24h', '24h'], ['7d', '7d'], ['30d', '30d']]} />
        <button className="btn-outline" onClick={() => setLogs(true)}><Download size={14} />Logs</button>
      </PageHeader>
      <div className={`mb-4 flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-[13px] font-semibold ${banner[0]}`}>
        <span className="flex items-center gap-2"><Icon size={16} />{banner[2]}</span>
        <span className="text-xs font-medium">Last checked {ago(data.generatedAt)}</span>
      </div>
      {data.alerts.map((a) => (
        <div key={a.id} className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-bad/25 bg-bad-soft px-4 py-2.5 text-[13px] text-bad">
          <span><b>{a.service}:</b> {a.message}</span>
          {a.status === 'OPEN' ? <button className="btn-outline btn-sm" onClick={act(() => api.post(`/system/alerts/${a.id}/ack`), 'Acknowledged')}>Acknowledge</button> : <span className="text-xs">Acknowledged</span>}
        </div>
      ))}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Uptime" value={`${data.uptime}%`} sub="Target 99.5%" tone={data.uptime < 99.5 ? 'bad' : undefined} />
        <Kpi label="Response time (p95)" value={`${data.p95} ms`} sub={`Check-in API: ${data.checkInP95} ms`} tone={data.p95 >= ALERT_MS ? 'bad' : undefined} />
        <Kpi label="Error rate" value={`${data.errorRate}%`} sub={`5xx of ${data.requests} requests`} tone={data.errorRate > 1 ? 'bad' : undefined} />
        <Kpi label="Active sessions" value={data.activeSessions} sub={`${data.requestsPerHour} requests per hour`} />
        <Kpi label="Emails delivered" value={data.email.rate === null ? '—' : `${data.email.rate}%`} sub={`${data.email.sent} sent, ${data.email.failed} failed`} />
        <Kpi label="Companies" value={data.companies} sub={`${data.seats.used} people · ${data.checkInsToday} check-ins today`} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Response time (p95, ms)" action={<span className="text-xs text-ink-muted">Range: {range}</span>}>
          <ResponseChart series={data.series} />
        </Card>
        <Card title="Services">
          <div className="divide-y divide-line">
            {data.services.map((s) => (
              <div key={s.key} className="flex items-center gap-2 py-1.5 text-[13px]">
                <span className={`h-2 w-2 rounded-full ${DOT[s.status]}`} />
                <span className="flex-1 truncate">{s.name}</span>
                <span className="hidden truncate text-xs text-ink-muted sm:inline">{s.detail}</span>
                <StatusPill status={s.status}>{STATUS_LABEL[s.status]}</StatusPill>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Background jobs">
          <div className="divide-y divide-line">
            {data.jobs.map((j) => (
              <div key={j.name} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0"><div className="text-[13px] font-semibold">{j.label}</div><div className="truncate text-xs text-ink-muted">{j.schedule}{j.lastRun ? ` · last run ${ago(j.lastRun)}` : ' · not run yet'}{j.detail ? ` · ${j.detail}` : ''}</div></div>
                <StatusPill status={j.ok === null ? 'off' : j.ok ? 'operational' : 'down'}>{j.ok === null ? 'Scheduled' : j.ok ? 'OK' : 'Failed'}</StatusPill>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Recent errors">
          {!data.errors.length && <Empty>No errors recorded.</Empty>}
          <div className="divide-y divide-line">
            {data.errors.map((e) => (
              <div key={e.id} className="flex justify-between gap-3 py-2">
                <div className="min-w-0"><div className="truncate text-[13px] font-semibold">{e.endpoint} · {e.status}</div><div className="truncate text-xs text-ink-muted">{e.message}{e.count > 1 ? ` · ${e.count} times` : ''}</div></div>
                <span className="shrink-0 text-xs text-ink-muted">{fmtTime(e.lastAt)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Security">
          {row('Failed sign-ins (24h)', data.security.failedLogins)}
          {row('Accounts locked', data.security.locked.length, data.security.locked[0] && <button className="btn-outline btn-sm" onClick={act(() => api.post(`/system/users/${data.security.locked[0].id}/unlock`), 'Unlocked')}>Unlock</button>)}
          {row('Admins without 2FA', data.security.adminsNo2fa)}
          {row('Last backup', data.security.lastBackup ? `${fmtDateTime(data.security.lastBackup.at)} · ${bytes(data.security.lastBackup.sizeBytes)}` : 'None yet')}
        </Card>
        <Card title="Usage & storage">
          <div className="space-y-2.5">
            {[['Database', data.usage.databaseBytes, dbMax, bytes, 'rgb(var(--brand-bright))'], ['File uploads (sick notes, docs)', data.usage.uploadBytes, uploadMax, bytes, 'rgb(var(--teal))'], ['Daily active users', data.usage.activeUsers, data.usage.totalUsers, String, 'rgb(var(--info))'], ['Calendar connections', data.usage.calendarUsers, data.usage.totalUsers, String, 'rgb(var(--violet))']].map(([label, v, max, f, colour]) => (
              <div key={label}>
                <div className="mb-1 flex justify-between text-[13px]"><span>{label}</span><b>{f(v)} / {f(max)}</b></div>
                <Bar value={v} max={max} color={colour} />
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link className="btn-outline" to="/system/settings"><SlidersHorizontal size={14} />System settings</Link>
            <Link className="btn-outline" to="/system/companies"><KeyRound size={14} />Companies</Link>
          </div>
        </Card>
      </div>
      {logs && <LogsModal onClose={() => setLogs(false)} />}
    </>
  )
}
