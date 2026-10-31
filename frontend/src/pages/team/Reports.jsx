import { useState } from 'react'
import { Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../../contexts/AuthContext'
import { useFetch } from '../../components/hooks'
import { Field, PageError, PageHeader, PageLoader, Segmented, Table } from '../../components/ui'
import { addDays, companyToday } from '../../utils/format'
import { download, errorMessage } from '../../services/api'

const KINDS = [['attendance', 'Attendance'], ['timesheets', 'Timesheets'], ['leave', 'Leave'], ['comparison', 'Attendance vs timesheets']]

export default function Reports() {
  const { isAdmin } = useAuth()
  const today = companyToday()
  const [kind, setKind] = useState('attendance')
  const [from, setFrom] = useState(addDays(today, -29))
  const [to, setTo] = useState(today)
  const [departmentId, setDepartmentId] = useState('')
  const query = `from=${from}&to=${to}${departmentId ? `&departmentId=${departmentId}` : ''}`
  const { data, error, reload, loading } = useFetch(`/reports/${kind}?${query}`)
  const { data: depts } = useFetch(isAdmin ? '/settings/departments' : null)
  const exportAs = (format) => download(`/reports/${kind}?${query}&format=${format}`, `${kind}.${format}`).catch((e) => toast.error(errorMessage(e)))
  return (
    <>
      <PageHeader title="Reports" subtitle={isAdmin ? 'Company-wide' : 'Your team only'}>
        <button className="btn-outline" onClick={() => exportAs('csv')}><Download size={14} />CSV</button>
        <button className="btn-primary" onClick={() => exportAs('xlsx')}><Download size={14} />Excel</button>
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Segmented value={kind} onChange={setKind} options={KINDS} />
        <Field label="From"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        {isAdmin && (
          <Field label="Department">
            <select className="input" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">All</option>{depts?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
        )}
      </div>
      {error && <PageError message={error} onRetry={reload} />}
      {!data && loading && <PageLoader />}
      {data && (
        <Table>
          <thead className="bg-subtle"><tr>{data.columns.map((c) => <th key={c.key} className="th">{c.label}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {!data.rows.length && <tr><td colSpan={data.columns.length} className="td text-center text-ink-muted">No data in this period.</td></tr>}
            {data.rows.slice(0, 300).map((r, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <tr key={i}>{data.columns.map((c) => <td key={c.key} className="td">{r[c.key]}</td>)}</tr>
            ))}
          </tbody>
        </Table>
      )}
      {data?.rows.length > 300 && <p className="mt-2 text-xs text-ink-muted">Showing the first 300 of {data.rows.length} rows. Export to see them all.</p>}
    </>
  )
}
