import { useState } from 'react'
import { Paperclip, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { useFetch } from '../../components/hooks'
import { Field, Modal, PageError, PageHeader, PageLoader, Pill, Segmented, Table } from '../../components/ui'
import { addDays, companyToday, fmtDay, money } from '../../utils/format'
import api, { download, errorMessage, uploadFile } from '../../services/api'

const fail = (err) => toast.error(errorMessage(err))
const STATE = { DRAFT: ['neutral', 'Draft'], RUNNING: ['ok', 'Running'], EXPIRED: ['warn', 'Expired'], CANCELLED: ['bad', 'Cancelled'] }
const TYPES = { PERMANENT: 'Permanent', FIXED_TERM: 'Fixed term', PART_TIME: 'Part time', INTERN: 'Internship' }

function ContractForm({ contract, onClose, onSaved }) {
  const { data } = useFetch('/people/directory')
  const c = contract
  const [form, setForm] = useState({
    userId: c?.userId || '', contractType: c?.contractType || 'PERMANENT', jobTitle: c?.jobTitle || '', startDate: c?.startDate || companyToday(), endDate: c?.endDate || '', probationEnd: c?.probationEnd || '',
    wage: c?.wage || '', workPermitNumber: c?.workPermitNumber || '', workPermitExpiry: c?.workPermitExpiry || '', notes: c?.notes || '', documentFileId: c?.documentFileId || '',
  })
  const [file, setFile] = useState(null)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const upload = async (e) => {
    if (!e.target.files[0]) return
    try {
      const f = await uploadFile(e.target.files[0], 'contract')
      setFile(f)
      setForm({ ...form, documentFileId: f.id })
    } catch (err) { fail(err) }
  }
  const submit = async (e) => {
    e.preventDefault()
    try {
      if (c) await api.patch(`/contracts/${c.id}`, form)
      else await api.post('/contracts', form)
      onSaved()
    } catch (err) { fail(err) }
  }
  return (
    <Modal title={c ? `Contract ${c.reference}` : 'New contract'} wide onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Employee"><select required disabled={Boolean(c)} className="input" value={form.userId} onChange={set('userId')}><option value="">Choose</option>{data?.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Contract type"><select className="input" value={form.contractType} onChange={set('contractType')}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Job title"><input className="input" value={form.jobTitle} onChange={set('jobTitle')} /></Field>
        <Field label="Monthly wage"><input type="number" min="0" step="0.01" required className="input" value={form.wage} onChange={set('wage')} /></Field>
        <Field label="Start date"><input type="date" required className="input" value={form.startDate} onChange={set('startDate')} /></Field>
        <Field label="End date" hint="Empty for permanent"><input type="date" className="input" value={form.endDate} onChange={set('endDate')} /></Field>
        <Field label="Probation ends"><input type="date" className="input" value={form.probationEnd} onChange={set('probationEnd')} /></Field>
        <Field label="Work permit number"><input className="input" value={form.workPermitNumber} onChange={set('workPermitNumber')} /></Field>
        <Field label="Work permit expires" hint="HR is alerted 60 days before"><input type="date" className="input" value={form.workPermitExpiry} onChange={set('workPermitExpiry')} /></Field>
        <Field label="Signed contract"><label className="btn-outline cursor-pointer"><Paperclip size={14} />{file?.name || (form.documentFileId ? 'Replace file' : 'Attach file')}<input type="file" className="hidden" onChange={upload} /></label></Field>
        <div className="sm:col-span-2"><Field label="Notes"><textarea rows={2} className="input" value={form.notes} onChange={set('notes')} /></Field></div>
        <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="btn-outline" onClick={onClose}>Cancel</button><button className="btn-primary">Save</button></div>
      </form>
    </Modal>
  )
}

export default function Contracts() {
  const [state, setState] = useState('')
  const { data, error, reload } = useFetch(`/contracts?state=${state}`)
  const [editing, setEditing] = useState(null)
  if (error) return <PageError message={error} onRetry={reload} />
  if (!data) return <PageLoader />
  const act = (url) => (e) => { e.stopPropagation(); api.post(url).then(reload).catch(fail) }
  const soon = addDays(companyToday(), 60)
  const warn = (c) => [
    c.endDate && c.endDate <= soon && c.state === 'RUNNING' && `Ends ${fmtDay(c.endDate, 'd MMM')}`,
    c.probationEnd && c.probationEnd >= companyToday() && c.probationEnd <= soon && `Probation to ${fmtDay(c.probationEnd, 'd MMM')}`,
    c.workPermitExpiry && c.workPermitExpiry <= soon && `Permit ${fmtDay(c.workPermitExpiry, 'd MMM')}`,
  ].filter(Boolean)
  return (
    <>
      <PageHeader title="Contracts" subtitle="Employment contracts, probation and work permits">
        <button className="btn-primary" onClick={() => setEditing({})}><Plus size={14} />New</button>
      </PageHeader>
      <div className="mb-3"><Segmented value={state} onChange={setState} options={[['', 'All'], ['DRAFT', 'Draft'], ['RUNNING', 'Running'], ['EXPIRED', 'Expired']]} /></div>
      <Table>
        <thead className="bg-subtle"><tr><th className="th">Reference</th><th className="th">Employee</th><th className="th">Type</th><th className="th">Start</th><th className="th">End</th><th className="th text-right">Wage</th><th className="th">Status</th><th className="th" /></tr></thead>
        <tbody className="divide-y divide-line">
          {!data.contracts.length && <tr><td colSpan={8} className="td text-center text-ink-muted">No contracts.</td></tr>}
          {data.contracts.map((c) => (
            <tr key={c.id} className="cursor-pointer hover:bg-subtle/50" onClick={() => setEditing(c)}>
              <td className="td font-semibold">{c.reference}</td>
              <td className="td">{c.userName}{warn(c).map((w) => <Pill key={w} tone="warn" className="ml-1.5">{w}</Pill>)}</td>
              <td className="td">{TYPES[c.contractType]}</td><td className="td whitespace-nowrap">{fmtDay(c.startDate, 'd MMM yyyy')}</td><td className="td whitespace-nowrap">{c.endDate ? fmtDay(c.endDate, 'd MMM yyyy') : '—'}</td>
              <td className="td text-right tabular-nums">{money(c.wage)}</td>
              <td className="td"><Pill tone={STATE[c.state][0]}>{STATE[c.state][1]}</Pill></td>
              <td className="td whitespace-nowrap text-right">
                {c.documentFileId && <button className="btn-outline btn-sm mr-1" aria-label="Open contract file" onClick={(e) => { e.stopPropagation(); download(`/files/${c.documentFileId}`, 'contract').catch(fail) }}><Paperclip size={12} /></button>}
                {c.state === 'DRAFT' && <button className="btn-primary btn-sm" onClick={act(`/contracts/${c.id}/start`)}>Start</button>}
                {c.state === 'RUNNING' && <button className="btn-outline btn-sm" onClick={act(`/contracts/${c.id}/close`)}>Close</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {editing && <ContractForm contract={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </>
  )
}
