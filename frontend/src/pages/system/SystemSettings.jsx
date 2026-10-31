import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useFetch } from '../../components/hooks'
import { Card, Empty, Field, PageError, PageHeader, PageLoader, Pill, Toggle } from '../../components/ui'
import { bytes, fmtDateTime } from '../../utils/format'
import api, { errorMessage } from '../../services/api'

const fail = (err) => toast.error(errorMessage(err))

export default function SystemSettings() {
  const { data, error, reload } = useFetch('/system/settings')
  const { data: backups, reload: reloadBackups } = useFetch('/system/backups')
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (data) setForm({ ...data.system, alertEmails: data.system.alertEmails.join(', ') }) }, [data])
  if (error) return <PageError message={error} onRetry={reload} />
  if (!form) return <PageLoader />
  const save = async () => {
    try {
      await api.put('/system/settings', { system: { ...form, alertEmails: form.alertEmails.split(',').map((s) => s.trim()).filter(Boolean) } })
      toast.success('Saved')
      reload()
    } catch (err) { fail(err) }
  }
  const backup = async () => {
    setBusy(true)
    try {
      await api.post('/system/backups', {}, { timeout: 120000 })
      toast.success('Backup finished')
    } catch (err) { fail(err) } finally {
      setBusy(false)
      reloadBackups()
    }
  }
  return (
    <>
      <PageHeader title="System Settings" subtitle="Applies to the whole platform"><button className="btn-primary" onClick={save}>Save changes</button></PageHeader>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Maintenance">
          <div className="flex items-center justify-between text-[13px]"><span><b>Maintenance mode</b><br /><span className="text-xs text-ink-muted">Everyone except you is shut out, in every company.</span></span><Toggle label="Maintenance mode" checked={form.maintenance} onChange={(v) => setForm({ ...form, maintenance: v })} /></div>
          <div className="mt-3"><Field label="Maintenance message"><input className="input" value={form.maintenanceMessage} onChange={(e) => setForm({ ...form, maintenanceMessage: e.target.value })} /></Field></div>
        </Card>
        <Card title="Alerts and backups">
          <Field label="Alert emails" hint="Comma-separated. You are always notified in-app."><input className="input" value={form.alertEmails} onChange={(e) => setForm({ ...form, alertEmails: e.target.value })} /></Field>
          <div className="mt-3"><Field label="Backups kept (days)"><input type="number" min="1" className="input" value={form.backupRetentionDays} onChange={(e) => setForm({ ...form, backupRetentionDays: Number(e.target.value) })} /></Field></div>
        </Card>
        <Card title="Backups" className="lg:col-span-2" action={<button className="btn-outline" disabled={busy} onClick={backup}>{busy ? 'Running…' : 'Run backup now'}</button>}>
          {!backups?.backups.length && <Empty>No backups yet. One runs automatically after 02:00.</Empty>}
          <div className="max-h-52 divide-y divide-line overflow-y-auto">
            {backups?.backups.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-2 py-1.5 text-[13px]">
                <span>{fmtDateTime(b.startedAt)}{b.ok ? ` · ${bytes(b.sizeBytes)}` : ''}</span>
                {b.ok === null ? <Pill tone="info">Running</Pill> : b.ok ? <Pill tone="ok">OK</Pill> : <Pill tone="bad" className="max-w-[220px] truncate">{b.detail || 'Failed'}</Pill>}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  )
}
