import { useEffect, useState } from 'react'
import { Lock, Trash2, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../contexts/AuthContext'
import { useFetch } from '../components/hooks'
import { Avatar, Card, Empty, Field, PageError, PageHeader, PageLoader, Pill } from '../components/ui'
import { fmtDay, fmtDateTime } from '../utils/format'
import { SECTIONS, SectionFields, masksOf, toForm } from '../components/EmployeeDetails'
import api, { download, errorMessage, uploadFile } from '../services/api'

function Documents({ userId }) {
  const { data, reload } = useFetch(`/profile/${userId}/documents`)
  const [name, setName] = useState('')
  const upload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      const f = await uploadFile(file, 'profile')
      await api.post(`/profile/${userId}/documents`, { name: name || file.name, fileId: f.id })
      setName('')
      reload()
    } catch (err) { toast.error(errorMessage(err)) }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1"><Field label="Document name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ID copy" /></Field></div>
        <label className="btn-primary cursor-pointer"><Upload size={14} />Upload<input type="file" className="hidden" onChange={upload} /></label>
      </div>
      {!data?.documents.length && <Empty>No documents yet.</Empty>}
      <div className="divide-y divide-line">
        {data?.documents.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
            <button className="link" onClick={() => download(`/files/${d.fileId}`, d.name).catch((err) => toast.error(errorMessage(err)))}>{d.name}</button>
            <button className="btn-outline btn-sm" aria-label={`Remove ${d.name}`} onClick={() => api.delete(`/profile/documents/${d.id}`).then(reload).catch((err) => toast.error(errorMessage(err)))}><Trash2 size={12} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}

function Signature({ value, onSaved }) {
  const pick = async (e) => {
    if (!e.target.files[0]) return
    try {
      const f = await uploadFile(e.target.files[0], 'photo')
      const { data } = await api.patch('/profile/me', { signatureFileId: f.id })
      onSaved(data.profile)
    } catch (err) { toast.error(errorMessage(err)) }
  }
  return (
    <div className="space-y-3">
      <div className="flex h-28 max-w-sm items-center justify-center rounded-xl border border-line bg-white">{value ? null : <span className="text-xs text-ink-muted">No signature uploaded</span>}{value && <span className="text-xs text-ok">Signature on file</span>}</div>
      <label className="btn-outline cursor-pointer">{value ? 'Replace signature' : 'Upload signature'}<input type="file" accept="image/*" className="hidden" onChange={pick} /></label>
    </div>
  )
}

export default function Profile() {
  const { user, refresh } = useAuth()
  const { data, error, reload, setData } = useFetch('/profile/me')
  const { data: history, reload: reloadHistory } = useFetch('/profile/me/history')
  const [form, setForm] = useState(null)
  const [tab, setTab] = useState('personal')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (data) setForm(toForm(data.profile)) }, [data])

  if (error) return <PageError message={error} onRetry={reload} />
  if (!data || !form) return <PageLoader />
  const p = data.profile
  const base = toForm(p)
  const dirty = Object.keys(form).some((k) => JSON.stringify(form[k]) !== JSON.stringify(base[k]))
  const save = async () => {
    setBusy(true)
    try {
      const { data: res } = await api.patch('/profile/me', form)
      setData({ profile: res.profile })
      toast.success(res.pendingRequest ? 'Saved. Sensitive changes are waiting for HR.' : 'Saved. HR has been notified.')
      reloadHistory()
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const changePhoto = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      const uploaded = await uploadFile(file, 'photo')
      const { data: res } = await api.patch('/profile/me', { photoFileId: uploaded.id })
      setData({ profile: res.profile })
      refresh()
      window.dispatchEvent(new Event('photo:changed'))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const Job = ({ k, v }) => <div className="flex justify-between gap-3 border-b border-line py-2 text-[13px]"><span className="text-ink-soft">{k}</span><span className="text-right font-medium">{v || '—'}</span></div>
  return (
    <>
      <PageHeader title="My Profile" subtitle="Keep your details up to date · HR is notified when you change anything" />
      <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
        <Card className="self-start">
          <Avatar name={p.name} size={84} photoFileId={p.photoFileId} />
          <label className="btn-outline btn-sm mt-3 cursor-pointer">Change photo<input type="file" accept="image/*" className="hidden" onChange={changePhoto} /></label>
          <h2 className="mt-2 text-lg font-bold">{p.name}</h2>
          {p.jobTitle && <p className="text-[15px] font-semibold text-brand-ink">{p.jobTitle}</p>}
          <p className="text-[13px] text-ink-soft">{p.department}</p>
          <div className="mt-2">
            <Job k="Employee no." v={p.employeeNo} /><Job k="Work email" v={p.email} /><Job k="Team" v={p.team} /><Job k="Manager" v={p.manager} />
            <Job k="Start date" v={fmtDay(p.startDate, 'd MMM yyyy')} /><Job k="Schedule" v={p.schedule} /><Job k="Salary band" v={p.salaryBand} />
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted"><Lock size={12} />Job details are managed by HR</p>
        </Card>
        <div className="grid min-w-0 gap-4 lg:grid-cols-[200px_1fr]">
          <nav className="card self-start !p-2" aria-label="Profile sections">
            {[...SECTIONS.map((x) => [x.key, x.label]), ['documents', 'Documents'], ['signature', 'eSignature']].map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} className={`block w-full rounded-lg px-3 py-2 text-left text-[13px] font-medium ${tab === k ? 'bg-subtle font-semibold' : 'text-ink-soft hover:bg-subtle/60'}`}>{label}</button>
            ))}
          </nav>
          <Card className="min-w-0">
            <h3 className="mb-3 text-[15px] font-bold">{[...SECTIONS].find((x) => x.key === tab)?.label || (tab === 'documents' ? 'Documents' : 'eSignature')}</h3>
            {tab === 'documents' && <Documents userId={p.id} />}
            {tab === 'signature' && <Signature value={p.signatureFileId} onSaved={(profile) => setData({ profile })} />}
            {SECTIONS.find((x) => x.key === tab) && (
              <>
                <SectionFields section={SECTIONS.find((x) => x.key === tab)} value={form} onChange={setForm} masks={masksOf(p)} mode={user.isOwner ? 'owner' : 'self'} />
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
                  <span className="text-[13px] text-ink-muted">{dirty ? 'Unsaved changes' : 'No unsaved changes'}</span>
                  <div className="flex gap-2">
                    <button className="btn-outline" disabled={!dirty} onClick={() => setForm(base)}>Discard</button>
                    <button className="btn-primary" disabled={!dirty || busy} onClick={save}>Save changes</button>
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
      <Card title="Change history" className="mt-4">
        {!history?.items.length && <Empty>No changes yet.</Empty>}
        <div className="divide-y divide-line">
          {history?.items.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
              <span>{h.label}{h.reason ? <span className="text-bad"> · {h.reason}</span> : ''}</span>
              <span className="flex items-center gap-2"><Pill tone={h.status.startsWith('Approved') ? 'ok' : h.status.startsWith('Rejected') ? 'bad' : h.status.startsWith('Pending') ? 'warn' : 'info'}>{h.status}</Pill><span className="text-xs text-ink-muted">{fmtDateTime(h.at)}</span></span>
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}
