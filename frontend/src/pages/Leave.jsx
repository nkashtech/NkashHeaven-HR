import { useEffect, useState } from 'react'
import { AlertTriangle, Download, Paperclip, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useFetch } from '../components/hooks'
import { Card, Empty, Field, Kpi, PageError, PageHeader, PageLoader, StatusPill } from '../components/ui'
import { companyToday, fmtDay, fmtRange } from '../utils/format'
import api, { download, errorMessage, uploadFile } from '../services/api'

const LABEL = { DRAFT: 'Draft', SUBMITTED: 'Submitted', PARTLY_APPROVED: 'Partly approved', APPROVED: 'Approved', REFUSED: 'Refused', CANCELLED: 'Cancelled' }

// Submitted, then each approval step of the leave type, e.g. Manager then HR.
function Stepper({ state, steps = [], stepIndex = 0 }) {
  const reached = { DRAFT: 0, SUBMITTED: 1, PARTLY_APPROVED: 1 + stepIndex, APPROVED: 1 + steps.length }[state] ?? 1
  const Dot = ({ on, bad }) => <span className={`h-2.5 w-2.5 rounded-full ${bad ? 'bg-bad' : on ? 'bg-ok' : 'bg-line'}`} />
  return (
    <div className="hidden items-center gap-1.5 text-[11px] text-ink-soft sm:flex">
      {['Submitted', ...steps].map((s, i) => (
        <span key={s} className="flex items-center gap-1.5">
          {i > 0 && <span className="h-px w-3 bg-line" />}
          <Dot on={reached > i} bad={state === 'REFUSED' && i === reached} />{s}
        </span>
      ))}
    </div>
  )
}

function RequestForm({ balances, onDone }) {
  const today = companyToday()
  const blank = { leaveTypeId: '', dateFrom: today, dateTo: today, halfDay: false, reason: '' }
  const [form, setForm] = useState(blank)
  const [attachment, setAttachment] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const type = balances.find((b) => b.leaveTypeId === Number(form.leaveTypeId))

  useEffect(() => {
    if (!form.leaveTypeId || !form.dateFrom || !form.dateTo) { setPreview(null); return }
    let live = true
    api.post('/leave/preview', form).then((r) => live && setPreview(r.data)).catch((err) => live && setPreview({ problems: [errorMessage(err)], days: 0, excluded: [] }))
    return () => { live = false }
  }, [form])

  const attach = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      setAttachment(await uploadFile(file, 'leave'))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post('/leave/requests', { ...form, attachmentId: attachment?.id })
      toast.success('Request submitted')
      setForm(blank)
      setAttachment(null)
      onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const blocked = !preview || preview.problems?.length > 0 || (preview.attachmentRequired && !attachment)
  return (
    <Card title="New request">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Leave type">
          <select required className="input" value={form.leaveTypeId} onChange={set('leaveTypeId')}>
            <option value="">Choose</option>
            {balances.map((b) => <option key={b.leaveTypeId} value={b.leaveTypeId}>{b.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><input type="date" required className="input" value={form.dateFrom} onChange={(e) => setForm({ ...form, dateFrom: e.target.value, dateTo: e.target.value > form.dateTo ? e.target.value : form.dateTo })} /></Field>
          <Field label="To"><input type="date" required min={form.dateFrom} className="input" value={form.dateTo} onChange={set('dateTo')} /></Field>
        </div>
        {type?.halfDayAllowed && form.dateFrom === form.dateTo && (
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={form.halfDay} onChange={set('halfDay')} className="h-4 w-4 accent-brand" />Half day (single day only)</label>
        )}
        <Field label="Reason"><textarea rows={2} className="input" value={form.reason} onChange={set('reason')} /></Field>
        <div>
          {attachment ? (
            <span className="inline-flex items-center gap-2 rounded-lg bg-subtle px-3 py-1.5 text-[13px]"><Paperclip size={13} />{attachment.name}<button type="button" onClick={() => setAttachment(null)} aria-label="Remove file"><X size={13} /></button></span>
          ) : (
            <label className="btn-outline cursor-pointer"><Paperclip size={14} />Attach document<input type="file" className="hidden" onChange={attach} /></label>
          )}
        </div>
        {preview && (
          <div className="rounded-xl bg-subtle px-4 py-3 text-[13px]">
            <div className="flex justify-between"><span className="text-ink-soft">Duration (working days)</span><b>{preview.days} days</b></div>
            {preview.bookable !== null && preview.bookable !== undefined && (
              <>
                <div className="mt-1 flex justify-between"><span className="text-ink-soft">Available now</span><b>{preview.bookable} days</b></div>
                <div className="mt-1 flex justify-between"><span className="text-ink-soft">Balance after</span><b>{preview.balanceAfter} days</b></div>
              </>
            )}
            {preview.excluded?.length > 0 && <p className="mt-1 text-xs text-ink-muted">Weekends and public holidays ({preview.excluded.map((x) => fmtDay(x.date, 'd MMM')).join(', ')}) are not counted.</p>}
            {preview.problems?.map((p) => <p key={p} className="mt-1 text-xs font-semibold text-bad">{p}</p>)}
            {preview.attachmentRequired && !attachment && <p className="mt-1 text-xs font-semibold text-bad">This request needs a supporting document.</p>}
          </div>
        )}
        <button className="btn-primary w-full !py-2.5" disabled={blocked || busy}>Submit request</button>
      </form>
    </Card>
  )
}

function Statement({ balances, year }) {
  const types = balances.filter((b) => b.requiresAllocation)
  const [typeId, setTypeId] = useState(types[0]?.leaveTypeId)
  const { data } = useFetch(typeId ? `/leave/statement?leaveTypeId=${typeId}&year=${year}` : null)
  const signed = (n) => `${n > 0 ? '+' : ''}${n}`
  const pdf = () => download(`/leave/statement?leaveTypeId=${typeId}&year=${year}&format=pdf`, 'leave-statement.pdf').catch((e) => toast.error(errorMessage(e)))
  return (
    <Card
      title={`${data?.type.name || 'Leave'} statement · ${year}`}
      action={(
        <div className="flex gap-2">
          <select className="input !w-auto !py-1.5" value={typeId} onChange={(e) => setTypeId(Number(e.target.value))} aria-label="Leave type">
            {types.map((t) => <option key={t.leaveTypeId} value={t.leaveTypeId}>{t.name}</option>)}
          </select>
          <button className="btn-outline" onClick={pdf}><Download size={14} />Download PDF</button>
        </div>
      )}
    >
      {data && (
        <div className="text-[13px]">
          {data.lines.map((l) => (
            <div key={`${l.label}${l.period}`} className="grid grid-cols-[1fr_auto_60px] gap-3 border-b border-line py-2"><span>{l.label}</span><span className="text-ink-muted">{l.status || l.period}</span><b className="text-right">{signed(l.days)}</b></div>
          ))}
          <div className="mt-1 flex justify-between rounded-lg bg-subtle px-3 py-2 font-bold"><span>Available today</span><span>{data.availableToday} days</span></div>
          {data.pending.map((l) => (
            <div key={l.period} className="grid grid-cols-[1fr_auto_60px] gap-3 py-2"><span>{l.label} · {l.period}</span><span className="text-ink-muted">{l.status}</span><b className="text-right text-brand-ink">{signed(l.days)}</b></div>
          ))}
          {data.type.maxCarryOver && <p className="mt-1 text-xs text-ink-muted">Up to {data.type.maxCarryOver} unused days carry over to {year + 1}; they must be used by {data.type.carryExpiry} {year + 1}.</p>}
        </div>
      )}
    </Card>
  )
}

export default function Leave() {
  const { data: bal, error, reload } = useFetch('/leave/balances')
  const { data: req, reload: reloadRequests } = useFetch('/leave/requests')
  const { data: overview, reload: reloadOverview } = useFetch('/leave/overview')
  if (error) return <PageError message={error} onRetry={reload} />
  if (!bal) return <PageLoader />
  const all = () => { reload(); reloadRequests(); reloadOverview() }
  const cancel = async (id) => {
    try {
      await api.post(`/leave/requests/${id}/cancel`)
      toast.success('Request cancelled and balance restored')
      all()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const today = companyToday()
  return (
    <>
      <PageHeader title="Leave" subtitle={`Balances for the ${bal.year} leave cycle`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {bal.balances.map((b) => (
          <Kpi key={b.leaveTypeId} label={b.name} value={b.requiresAllocation ? <>{b.available} <span className="text-[13px] font-medium text-ink-soft">days left</span></> : '—'} sub={b.requiresAllocation ? `${b.allocated} allocated · ${b.taken} taken${b.pending ? ` · ${b.pending} pending` : ''}` : 'No allocation needed'} />
        ))}
      </div>
      {bal.expiring.map((x) => (
        <div key={x.leaveType} className="mt-3 flex items-center gap-2 rounded-xl bg-warn-soft px-4 py-2.5 text-[13px] text-warn"><AlertTriangle size={15} />{x.days} carried-over {x.leaveType.toLowerCase()} days expire on {fmtDay(x.expires, 'd MMM yyyy')}. Use them or lose them.</div>
      ))}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <RequestForm balances={bal.balances} onDone={all} />
        <Card title="My requests" className="self-start">
          {!req?.requests.length && <Empty>No requests yet.</Empty>}
          <div className="divide-y divide-line">
            {req?.requests.slice(0, 8).map((r) => (
              <div key={r.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold">{r.leaveType.name} · {r.days} day{r.days === 1 ? '' : 's'}</div>
                    <div className="text-xs text-ink-muted">{fmtRange(r.dateFrom, r.dateTo)}</div>
                  </div>
                  <Stepper state={r.state} steps={r.steps} stepIndex={r.stepIndex} />
                  <StatusPill status={r.state}>{LABEL[r.state]}</StatusPill>
                </div>
                {r.refuseReason && <p className="mt-1 text-xs text-bad">Reason: {r.refuseReason}</p>}
                {['DRAFT', 'SUBMITTED', 'PARTLY_APPROVED', 'APPROVED'].includes(r.state) && r.dateFrom > today && (
                  <button className="btn-outline btn-sm mt-1.5" onClick={() => cancel(r.id)}>Cancel</button>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-muted">You can cancel a request until its first day. Refused requests show the approver's reason.</p>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Statement balances={bal.balances} year={bal.year} />
        <Card title="Who's off in my team">
          {!overview?.off.length && <Empty>Nobody is off soon.</Empty>}
          <div className="divide-y divide-line">
            {overview?.off.map((o) => <div key={o.id} className="flex justify-between gap-2 py-1.5 text-[13px]"><span>{o.name}</span><span className="text-ink-soft">{fmtDay(o.from, 'd MMM')}–{fmtDay(o.to, 'd MMM')}{o.pending ? ' (pending)' : ''}</span></div>)}
          </div>
          <h3 className="mt-4 text-[15px] font-bold">Next public holidays</h3>
          <div className="mt-1 divide-y divide-line">
            {overview?.holidays.map((h) => <div key={h.date} className="flex justify-between gap-2 py-1.5 text-[13px]"><span>{h.name}</span><span className="text-ink-soft">{fmtDay(h.date)}</span></div>)}
          </div>
        </Card>
      </div>
    </>
  )
}
