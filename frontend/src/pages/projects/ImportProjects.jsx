import { useState } from 'react'
import toast from 'react-hot-toast'
import { useFetch } from '../../components/hooks'
import { Field, Modal, Pill, Segmented, Spinner } from '../../components/ui'
import { fail } from './shared'
import api from '../../services/api'

function Results({ results }) {
  return (
    <div className="mt-3 space-y-1 text-[13px]">
      {results.map((r) => (
        <div key={r.project.name}>
          <b>{r.project.name}</b>: {r.error ? <span className="text-bad">{r.error}</span> : `${r.tasks} tasks imported`}
          {r.unmatched?.length > 0 && <p className="text-xs text-warn">Not assigned, no matching account: {r.unmatched.join(', ')}</p>}
        </div>
      ))}
    </div>
  )
}

function FromApi({ stages, onDone }) {
  const { data, error, reload, loading } = useFetch('/projects/import/clickup')
  const [token, setToken] = useState('')
  const [picked, setPicked] = useState([])
  const [stageId, setStageId] = useState(stages[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState(null)
  const connect = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post('/projects/import/clickup/token', { apiToken: token })
      setToken('')
      await reload()
    } catch (err) { fail(err) } finally { setBusy(false) }
  }
  const run = async () => {
    setBusy(true)
    try {
      const { data: r } = await api.post('/projects/import/clickup', { listIds: picked, stageId }, { timeout: 300000 })
      setResults(r.results)
      toast.success('Import finished')
      onDone()
    } catch (err) { fail(err) } finally { setBusy(false) }
  }
  if (loading && !data) return <div className="py-6 text-center"><Spinner /></div>
  if (!data?.connected) {
    return (
      <form onSubmit={connect} className="space-y-3">
        {error && <p className="text-[13px] text-bad">{error}</p>}
        <p className="text-[13px] text-ink-soft">In ClickUp open your avatar, then Settings → Apps → API Token, and generate a personal token. It is stored encrypted and is only read from ClickUp.</p>
        <Field label="ClickUp API token"><input required autoComplete="off" className="input" placeholder="pk_..." value={token} onChange={(e) => setToken(e.target.value)} /></Field>
        <button className="btn-primary" disabled={busy}>{busy ? 'Connecting…' : 'Connect ClickUp'}</button>
      </form>
    )
  }
  const toggle = (id) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id])
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-ink-soft">Each ClickUp List becomes a project and its statuses become task stages. Assignees match by email. Importing the same list again updates it.</p>
      <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
        {data.lists.map((l) => (
          <label key={l.id} className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" className="accent-brand" checked={picked.includes(l.id)} onChange={() => toggle(l.id)} />
            <span className="min-w-0 flex-1 truncate">{l.name} <span className="text-xs text-ink-muted">{l.space}{l.folder ? ` / ${l.folder}` : ''}</span></span>
            {l.taskCount !== null && <Pill>{l.taskCount}</Pill>}
          </label>
        ))}
      </div>
      <Field label="Put new projects in stage"><select className="input" value={stageId} onChange={(e) => setStageId(e.target.value)}>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <button className="btn-primary" disabled={!picked.length || busy} onClick={run}>{busy ? 'Importing…' : `Import ${picked.length} list${picked.length === 1 ? '' : 's'}`}</button>
      {results && <Results results={results} />}
    </div>
  )
}

function FromCsv({ stages, onDone }) {
  const [form, setForm] = useState({ projectName: '', csv: '', stageId: stages[0]?.id || '' })
  const [results, setResults] = useState(null)
  const onFile = async (e) => {
    const f = e.target.files[0]
    if (f) setForm({ ...form, csv: await f.text(), projectName: form.projectName || f.name.replace(/\.csv$/i, '') })
  }
  const submit = async (e) => {
    e.preventDefault()
    try {
      const { data } = await api.post('/projects/import/csv', form, { timeout: 120000 })
      setResults([data.result])
      onDone()
    } catch (err) { fail(err) }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-[13px] text-ink-soft">In ClickUp use the view's Export option to get a CSV. It needs a Task Name column; Status, Due Date, Task Content and Assignees are used when present.</p>
      <input type="file" accept=".csv" className="text-[13px]" aria-label="CSV file" onChange={onFile} />
      <Field label="Project name"><input required className="input" value={form.projectName} onChange={(e) => setForm({ ...form, projectName: e.target.value })} /></Field>
      <button className="btn-primary" disabled={!form.csv}>Import</button>
      {results && <Results results={results} />}
    </form>
  )
}

export default function ImportProjects({ stages, onClose, onDone }) {
  const [tab, setTab] = useState('api')
  return (
    <Modal title="Import tasks from ClickUp" wide onClose={onClose}>
      <div className="mb-3"><Segmented value={tab} onChange={setTab} options={[['api', 'Connect with a token'], ['csv', 'Upload a CSV export']]} /></div>
      {tab === 'api' ? <FromApi stages={stages} onDone={onDone} /> : <FromCsv stages={stages} onDone={onDone} />}
    </Modal>
  )
}
