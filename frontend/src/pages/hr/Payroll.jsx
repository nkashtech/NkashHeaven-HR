import { useEffect, useState } from 'react'
import { Download, Plus, Printer, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useFetch } from '../../components/hooks'
import { Card, Empty, Field, Modal, PageError, PageHeader, PageLoader, Pill, Segmented, Table, Toggle } from '../../components/ui'
import { companyToday, fmtDay, fmtRange, money } from '../../utils/format'
import api, { download, errorMessage } from '../../services/api'

const fail = (err) => toast.error(errorMessage(err))
const STATE = { DRAFT: ['neutral', 'Draft'], VERIFIED: ['info', 'Verified'], DONE: ['warn', 'Published'], PAID: ['ok', 'Paid'] }
const pdf = (s) => download(`/payroll/payslips/${s.id}/pdf`, `${s.number}.pdf`).catch(fail)

export function PayslipModal({ id, onClose, onChanged, editable }) {
  const { data, reload } = useFetch(`/payroll/payslips/${id}`)
  const [line, setLine] = useState({ name: '', category: 'ALLOWANCE', amount: '' })
  if (!data) return null
  const s = data.payslip
  const add = async (e) => {
    e.preventDefault()
    try {
      await api.post(`/payroll/payslips/${id}/lines`, line)
      setLine({ name: '', category: 'ALLOWANCE', amount: '' })
      reload()
      onChanged?.()
    } catch (err) { fail(err) }
  }
  const remove = (l) => api.delete(`/payroll/payslips/${id}/lines/${l.id}`).then(() => { reload(); onChanged?.() }).catch(fail)
  const group = (cat) => s.lines.filter((l) => l.category === cat)
  const Row = ({ l, strong }) => (
    <div className={`flex items-center justify-between gap-2 border-b border-line py-1.5 text-[13px] ${strong ? 'font-bold' : ''}`}>
      <span>{l.name}{l.manual && <Pill className="ml-1.5">Added</Pill>}</span>
      <span className="flex items-center gap-2 tabular-nums">{money(l.amount)}{l.manual && editable && <button aria-label={`Remove ${l.name}`} onClick={() => remove(l)}><Trash2 size={12} /></button>}</span>
    </div>
  )
  return (
    <Modal title={`${s.userName} · ${s.period}`} wide onClose={onClose}>
      <div className="mb-3 flex items-center justify-between text-xs text-ink-muted"><span>{s.number} · {s.workedDays} worked days{s.unpaidDays ? ` · ${s.unpaidDays} unpaid` : ''}</span><button className="btn-primary" onClick={() => pdf(s)}><Printer size={14} />Print payslip</button></div>
      <div className="eyebrow">Earnings</div>{[...group('BASIC'), ...group('ALLOWANCE')].map((l) => <Row key={l.id} l={l} />)}
      <div className="eyebrow mt-3">Deductions</div>{group('DEDUCTION').map((l) => <Row key={l.id} l={l} />)}
      <div className="mt-2 flex justify-between rounded-lg bg-brand-soft px-3 py-2 text-[15px] font-bold text-brand-ink"><span>Net pay</span><span className="tabular-nums">{money(s.net)}</span></div>
      <div className="eyebrow mt-3">Paid by the employer</div>{group('EMPLOYER').map((l) => <Row key={l.id} l={l} />)}
      {editable && (
        <form onSubmit={add} className="mt-3 grid gap-2 sm:grid-cols-4">
          <div className="sm:col-span-2"><Field label="Add a line"><input required className="input" placeholder="e.g. Performance bonus" value={line.name} onChange={(e) => setLine({ ...line, name: e.target.value })} /></Field></div>
          <Field label="Type"><select className="input" value={line.category} onChange={(e) => setLine({ ...line, category: e.target.value })}><option value="ALLOWANCE">Earning</option><option value="DEDUCTION">Deduction</option></select></Field>
          <Field label="Amount"><input required type="number" step="0.01" className="input" value={line.amount} onChange={(e) => setLine({ ...line, amount: e.target.value })} /></Field>
          <div><button className="btn-outline">Add</button></div>
        </form>
      )}
    </Modal>
  )
}

function Batch({ id, onBack }) {
  const { data, error, reload } = useFetch(`/payroll/runs/${id}`)
  const [open, setOpen] = useState(null)
  if (error) return <PageError message={error} onRetry={reload} />
  if (!data) return <PageLoader />
  const { run, payslips } = data
  const step = (s) => api.post(`/payroll/runs/${id}/${s}`).then(reload).catch(fail)
  const recompute = () => api.post(`/payroll/runs/${id}/recompute`).then(() => { toast.success('Recomputed'); reload() }).catch(fail)
  const sum = (k) => payslips.reduce((n, p) => n + p[k], 0)
  return (
    <>
      <PageHeader title={run.name} subtitle={fmtRange(run.periodStart, run.periodEnd)}>
        <button className="btn-outline" onClick={onBack}>Back</button>
        <button className="btn-outline" onClick={() => download(`/payroll/runs/${id}/export`, 'payroll.csv').catch(fail)}><Download size={14} />Export</button>
        {run.state === 'DRAFT' && <><button className="btn-outline" onClick={recompute}>Compute sheet</button><button className="btn-primary" onClick={() => step('verify')}>Verify</button></>}
        {run.state === 'VERIFIED' && <><button className="btn-outline" onClick={() => step('reset')}>Back to draft</button><button className="btn-primary" onClick={() => step('confirm')}>Publish to employees</button></>}
        {run.state === 'DONE' && <button className="btn-primary" onClick={() => step('paid')}>Mark as paid</button>}
      </PageHeader>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-[13px]"><Pill tone={STATE[run.state][0]}>{STATE[run.state][1]}</Pill><span>{payslips.length} payslips</span><span>Gross <b>{money(sum('gross'))}</b></span><span>Net <b>{money(sum('net'))}</b></span></div>
      <Table>
        <thead className="bg-subtle"><tr><th className="th">Employee</th><th className="th">Number</th><th className="th">Worked days</th><th className="th text-right">Gross</th><th className="th text-right">Deductions</th><th className="th text-right">Net</th><th className="th" /></tr></thead>
        <tbody className="divide-y divide-line">
          {!payslips.length && <tr><td colSpan={7} className="td text-center text-ink-muted">No running contracts in this period.</td></tr>}
          {payslips.map((p) => (
            <tr key={p.id} className="cursor-pointer hover:bg-subtle/50" onClick={() => setOpen(p.id)}>
              <td className="td font-semibold">{p.userName}</td><td className="td text-ink-soft">{p.number}</td><td className="td">{p.workedDays}</td>
              <td className="td text-right tabular-nums">{money(p.gross)}</td><td className="td text-right tabular-nums">{money(p.deductions)}</td><td className="td text-right font-semibold tabular-nums">{money(p.net)}</td>
              <td className="td text-right"><button className="btn-outline btn-sm" aria-label={`Print ${p.userName}`} onClick={(e) => { e.stopPropagation(); pdf(p) }}><Printer size={12} /></button></td>
            </tr>
          ))}
        </tbody>
      </Table>
      {open && <PayslipModal id={open} editable={run.state === 'DRAFT'} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  )
}

function Rules() {
  const { data, reload } = useFetch('/payroll/settings')
  const [rule, setRule] = useState({ code: '', name: '', category: 'ALLOWANCE', amountType: 'FIXED', amount: '' })
  const [cfg, setCfg] = useState(null)
  useEffect(() => { if (data) setCfg(data.payroll) }, [data])
  if (!cfg) return <PageLoader />
  const add = async (e) => {
    e.preventDefault()
    try {
      await api.post('/payroll/rules', rule)
      setRule({ code: '', name: '', category: 'ALLOWANCE', amountType: 'FIXED', amount: '' })
      reload()
    } catch (err) { fail(err) }
  }
  const save = () => api.put('/payroll/settings', { ...cfg, brackets: cfg.brackets.map((b) => ({ upTo: b.upTo === '' || b.upTo === null ? null : Number(b.upTo), base: Number(b.base), rate: Number(b.rate) })), rebatePrimary: Number(cfg.rebatePrimary), rebateSecondary: Number(cfg.rebateSecondary), rebateTertiary: Number(cfg.rebateTertiary), uifRate: Number(cfg.uifRate), uifCeiling: Number(cfg.uifCeiling), sdlRate: Number(cfg.sdlRate) }).then(() => toast.success('Saved')).catch(fail)
  const setB = (i, k, v) => setCfg({ ...cfg, brackets: cfg.brackets.map((b, j) => (j === i ? { ...b, [k]: v } : b)) })
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Salary rules">
        <p className="mb-2 text-xs text-ink-muted">Basic, PAYE, UIF and SDL are computed for you. Add allowances and deductions here.</p>
        {data.rules.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 border-b border-line py-1.5 text-[13px]">
            <span><b>{r.name}</b> <span className="text-xs text-ink-muted">{r.category.toLowerCase()} · {r.amountType === 'FIXED' ? money(r.amount) : `${r.amount}% of basic`}</span></span>
            <Toggle label={r.name} checked={r.active} onChange={(v) => api.patch(`/payroll/rules/${r.id}`, { active: v }).then(reload).catch(fail)} />
          </div>
        ))}
        <form onSubmit={add} className="mt-3 grid grid-cols-2 gap-2">
          <Field label="Code"><input required className="input" value={rule.code} onChange={(e) => setRule({ ...rule, code: e.target.value })} /></Field>
          <Field label="Name"><input required className="input" value={rule.name} onChange={(e) => setRule({ ...rule, name: e.target.value })} /></Field>
          <Field label="Category"><select className="input" value={rule.category} onChange={(e) => setRule({ ...rule, category: e.target.value })}><option value="ALLOWANCE">Allowance</option><option value="DEDUCTION">Deduction</option><option value="EMPLOYER">Employer cost</option></select></Field>
          <Field label="Amount"><div className="flex gap-1"><input required type="number" step="0.01" className="input" value={rule.amount} onChange={(e) => setRule({ ...rule, amount: e.target.value })} /><select aria-label="Amount type" className="input !w-24" value={rule.amountType} onChange={(e) => setRule({ ...rule, amountType: e.target.value })}><option value="FIXED">Fixed</option><option value="PERCENT_BASIC">%</option></select></div></Field>
          <div><button className="btn-outline"><Plus size={14} />Add rule</button></div>
        </form>
      </Card>
      <Card title={`Tax tables · ${cfg.taxYear}`} action={<button className="btn-primary" onClick={save}>Save</button>}>
        <p className="mb-2 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">Confirm these against the current SARS tables with your accountant before running real payroll.</p>
        <table className="w-full text-[13px]"><thead><tr><th className="eyebrow text-left">Income up to</th><th className="eyebrow text-left">Base tax</th><th className="eyebrow text-left">Rate %</th></tr></thead>
          <tbody>{cfg.brackets.map((b, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <tr key={i}>{['upTo', 'base', 'rate'].map((k) => <td key={k} className="pr-2 pt-1"><input aria-label={`${k} row ${i + 1}`} className="input !py-1" placeholder={k === 'upTo' ? 'No limit' : ''} value={b[k] ?? ''} onChange={(e) => setB(i, k, e.target.value)} /></td>)}</tr>
          ))}</tbody>
        </table>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[['taxYear', 'Tax year'], ['rebatePrimary', 'Primary rebate'], ['rebateSecondary', 'Secondary rebate'], ['rebateTertiary', 'Tertiary rebate'], ['uifRate', 'UIF %'], ['uifCeiling', 'UIF ceiling'], ['sdlRate', 'SDL %'], ['currency', 'Currency']].map(([k, label]) => <Field key={k} label={label}><input className="input" value={cfg[k]} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} /></Field>)}
        </div>
      </Card>
    </div>
  )
}

export default function Payroll() {
  const [tab, setTab] = useState('batches')
  const [open, setOpen] = useState(null)
  const { data, error, reload } = useFetch('/payroll/runs')
  const today = companyToday()
  const [period, setPeriod] = useState(today.slice(0, 7))
  if (open) return <Batch id={open} onBack={() => { setOpen(null); reload() }} />
  if (error) return <PageError message={error} onRetry={reload} />
  if (!data) return <PageLoader />
  const create = async (e) => {
    e.preventDefault()
    const start = `${period}-01`
    const end = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5)), 0)).toISOString().slice(0, 10)
    try {
      const { data: r } = await api.post('/payroll/runs', { periodStart: start, periodEnd: end })
      toast.success(`${r.payslips} payslips generated`)
      setOpen(r.id)
    } catch (err) { fail(err) }
  }
  return (
    <>
      <PageHeader title="Payroll" subtitle="Payslip batches from running contracts"><Segmented value={tab} onChange={setTab} options={[['batches', 'Batches'], ['rules', 'Rules and tax']]} /></PageHeader>
      {tab === 'rules' ? <Rules /> : (
        <>
          <form onSubmit={create} className="mb-4 flex flex-wrap items-end gap-2">
            <Field label="Pay period"><input type="month" required className="input" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
            <button className="btn-primary"><Plus size={14} />Generate payslips</button>
          </form>
          <Table>
            <thead className="bg-subtle"><tr><th className="th">Batch</th><th className="th">Period</th><th className="th">Payslips</th><th className="th text-right">Gross</th><th className="th text-right">Net</th><th className="th">Status</th></tr></thead>
            <tbody className="divide-y divide-line">
              {!data.runs.length && <tr><td colSpan={6} className="td text-center text-ink-muted">No payroll run yet. Pick a period and generate one.</td></tr>}
              {data.runs.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-subtle/50" onClick={() => setOpen(r.id)}>
                  <td className="td font-semibold">{r.name}</td><td className="td whitespace-nowrap">{fmtRange(r.periodStart, r.periodEnd)}</td><td className="td">{r.payslips}</td>
                  <td className="td text-right tabular-nums">{money(r.gross)}</td><td className="td text-right tabular-nums">{money(r.net)}</td><td className="td"><Pill tone={STATE[r.state][0]}>{STATE[r.state][1]}</Pill></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </>
  )
}

export function MyPayslips() {
  const { data, error, reload } = useFetch('/payroll/my')
  const { data: contracts } = useFetch('/contracts/my')
  const [open, setOpen] = useState(null)
  if (error) return <PageError message={error} onRetry={reload} />
  if (!data) return <PageLoader />
  const current = contracts?.contracts.find((c) => c.state === 'RUNNING')
  return (
    <>
      <PageHeader title="My Payslips" subtitle={current ? `Contract ${current.reference} · since ${fmtDay(current.startDate, 'd MMM yyyy')}` : 'Your published payslips'} />
      <Card>
        {!data.payslips.length && <Empty>No payslips yet. They appear here once HR publishes payroll.</Empty>}
        <div className="divide-y divide-line">
          {data.payslips.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <button className="text-left" onClick={() => setOpen(p.id)}><div className="text-[13px] font-semibold">{p.period}</div><div className="text-xs text-ink-muted">{p.number}</div></button>
              <span className="flex items-center gap-3"><Pill tone={STATE[p.state][0]}>{STATE[p.state][1]}</Pill><b className="tabular-nums">{money(p.net)}</b><button className="btn-outline btn-sm" onClick={() => pdf(p)}><Printer size={12} />Print</button></span>
            </div>
          ))}
        </div>
      </Card>
      {open && <PayslipModal id={open} onClose={() => setOpen(null)} />}
    </>
  )
}
