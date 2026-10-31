import { useState } from 'react'
import { useFetch } from '../../components/hooks'
import { Field, Modal, PageError, PageHeader, PageLoader, Table } from '../../components/ui'
import { fmtDateTime } from '../../utils/format'

export default function Audit() {
  const [filters, setFilters] = useState({ actor: '', entity: '', from: '', to: '' })
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(null)
  const set = (k) => (e) => { setPage(1); setFilters({ ...filters, [k]: e.target.value }) }
  const query = new URLSearchParams({ ...filters, page }).toString()
  const { data, error, reload } = useFetch(`/settings/audit?${query}`)
  if (error) return <PageError message={error} onRetry={reload} />
  if (!data) return <PageLoader />
  return (
    <>
      <PageHeader title="Audit Log" subtitle={`${data.total} entries · who did what, with before and after`} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Who"><input className="input" value={filters.actor} onChange={set('actor')} /></Field>
        <Field label="Entity"><select className="input" value={filters.entity} onChange={set('entity')}><option value="">All</option>{data.entities.map((e) => <option key={e}>{e}</option>)}</select></Field>
        <Field label="From"><input type="date" className="input" value={filters.from} onChange={set('from')} /></Field>
        <Field label="To"><input type="date" className="input" value={filters.to} onChange={set('to')} /></Field>
      </div>
      <Table>
        <thead className="bg-subtle"><tr><th className="th">When</th><th className="th">Who</th><th className="th">Action</th><th className="th">Entity</th><th className="th">IP</th><th className="th" /></tr></thead>
        <tbody className="divide-y divide-line">
          {!data.logs.length && <tr><td colSpan={6} className="td text-center text-ink-muted">No entries match.</td></tr>}
          {data.logs.map((l) => (
            <tr key={l.id}>
              <td className="td whitespace-nowrap">{fmtDateTime(l.at)}</td>
              <td className="td">{l.actorName}</td>
              <td className="td font-medium">{l.action}</td>
              <td className="td text-ink-soft">{l.entity}{l.entityId ? ` #${l.entityId}` : ''}</td>
              <td className="td text-ink-soft">{l.ip || '—'}</td>
              <td className="td text-right">{(l.before || l.after) && <button className="btn-outline btn-sm" onClick={() => setOpen(l)}>Details</button>}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="mt-3 flex items-center justify-end gap-2 text-[13px]">
        <button className="btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span>Page {page} of {Math.max(1, data.pages)}</span>
        <button className="btn-outline btn-sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</button>
      </div>
      {open && (
        <Modal title={open.action} wide onClose={() => setOpen(null)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><h3 className="mb-1 text-[13px] font-bold">Before</h3><pre className="overflow-x-auto rounded-lg bg-subtle p-3 text-xs">{JSON.stringify(open.before, null, 2) || '—'}</pre></div>
            <div><h3 className="mb-1 text-[13px] font-bold">After</h3><pre className="overflow-x-auto rounded-lg bg-subtle p-3 text-xs">{JSON.stringify(open.after, null, 2) || '—'}</pre></div>
          </div>
        </Modal>
      )}
    </>
  )
}
