import { useState } from 'react'
import { Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { useFetch } from '../../components/hooks'
import { Field, Modal, PageError, PageHeader, PageLoader, Pill, Table, Toggle } from '../../components/ui'
import api, { errorMessage, session } from '../../services/api'

const fail = (err) => toast.error(errorMessage(err))
const FLAGS = { chat: 'Chat', calendar: 'Calendar', celebrations: 'People & Birthdays' }
const linkFor = (slug) => `${window.location.origin}/c/${slug}`

const sendLogo = (id, file) => {
  const body = new FormData()
  body.append('file', file)
  return api.post(`/system/companies/${id}/logo`, body)
}

function NewCompany({ onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', slug: '', adminName: '', adminEmail: '', seats: 100, timezone: 'Africa/Johannesburg' })
  const [logo, setLogo] = useState(null)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const suggested = form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const submit = async (e) => {
    e.preventDefault()
    try {
      const body = new FormData()
      Object.entries(form).forEach(([k, v]) => body.append(k, v))
      if (logo) body.append('file', logo)
      await api.post('/system/companies', body)
      toast.success('Company created and its admin invited')
      onSaved()
    } catch (err) { fail(err) }
  }
  return (
    <Modal title="New company" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Company name"><input required autoFocus className="input" value={form.name} onChange={set('name')} /></Field>
        <Field label="Company logo" hint="Optional. Without one the company uses the NkashHeaven logo until its admin adds their own."><input type="file" accept="image/*" className="input" onChange={(e) => setLogo(e.target.files[0] || null)} /></Field>
        <Field label="Company address" hint={`Staff sign in at ${linkFor(form.slug || suggested || 'your-company')}`}><input className="input" placeholder={suggested} value={form.slug} onChange={set('slug')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Admin name"><input required className="input" value={form.adminName} onChange={set('adminName')} /></Field>
          <Field label="Admin email"><input required type="email" className="input" value={form.adminEmail} onChange={set('adminEmail')} /></Field>
          <Field label="Seats"><input type="number" min="1" className="input" value={form.seats} onChange={set('seats')} /></Field>
          <Field label="Timezone"><input className="input" value={form.timezone} onChange={set('timezone')} /></Field>
        </div>
        <p className="text-xs text-ink-muted">The admin gets a welcome email with a temporary password. Starter roles, leave types, holidays and chat channels are set up for them, and they can change it all.</p>
        <button className="btn-primary w-full">Create company</button>
      </form>
    </Modal>
  )
}

function Detail({ company, onClose, onSaved }) {
  const [form, setForm] = useState({ name: company.name, slug: company.slug, seats: company.seats, flags: { chat: true, calendar: true, celebrations: true, ...company.flags } })
  const { data } = useFetch(`/system/companies/${company.id}/users`)
  const [viewAs, setViewAs] = useState({ userId: '', reason: '' })
  const save = async (patch) => {
    try {
      await api.patch(`/system/companies/${company.id}`, patch)
      onSaved()
    } catch (err) { fail(err) }
  }
  const start = async (e) => {
    e.preventDefault()
    try {
      const { data: r } = await api.post(`/system/impersonate/${viewAs.userId}`, { reason: viewAs.reason })
      session.save(r.token, false)
      window.location.href = '/'
    } catch (err) { fail(err) }
  }
  return (
    <Modal title={company.name} wide onClose={onClose}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Address"><input className="input" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></Field>
          <Field label="Seats"><input type="number" className="input" value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value })} /></Field>
          <Field label={company.hasLogo ? 'Replace logo' : 'Add logo'}><input type="file" accept="image/*" className="input" onChange={(e) => e.target.files[0] && sendLogo(company.id, e.target.files[0]).then(() => { toast.success('Logo saved'); onSaved() }).catch(fail)} /></Field>
        </div>
        <div>
          <div className="eyebrow mb-1">Modules</div>
          {Object.entries(FLAGS).map(([k, label]) => <div key={k} className="flex items-center justify-between py-1 text-[13px]"><span>{label}</span><Toggle label={label} checked={form.flags[k] !== false} onChange={(v) => setForm({ ...form, flags: { ...form.flags, [k]: v } })} /></div>)}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => save(form)}>Save</button>
          {company.active ? <button className="btn-danger" onClick={() => save({ active: false })}>Suspend company</button> : <button className="btn-outline" onClick={() => save({ active: true })}>Reactivate</button>}
        </div>
        <form onSubmit={start} className="border-t border-line pt-3">
          <div className="eyebrow mb-1">View as a user (read-only, 30 minutes, they are told)</div>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <select required className="input" aria-label="User" value={viewAs.userId} onChange={(e) => setViewAs({ ...viewAs, userId: e.target.value })}><option value="">Choose a person</option>{data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            <input required className="input" placeholder="Support reason" aria-label="Reason" value={viewAs.reason} onChange={(e) => setViewAs({ ...viewAs, reason: e.target.value })} />
            <button className="btn-outline">Start</button>
          </div>
        </form>
      </div>
    </Modal>
  )
}

export default function Companies() {
  const { data, error, reload } = useFetch('/system/companies')
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState(null)
  if (error) return <PageError message={error} onRetry={reload} />
  if (!data) return <PageLoader />
  return (
    <>
      <PageHeader title="Companies" subtitle="Each company has its own address, admin, people and data">
        <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={14} />New company</button>
      </PageHeader>
      <Table>
        <thead className="bg-subtle"><tr><th className="th">Company</th><th className="th">Sign-in link</th><th className="th">Admin</th><th className="th">Seats</th><th className="th">Status</th></tr></thead>
        <tbody className="divide-y divide-line">
          {!data.companies.length && <tr><td colSpan={5} className="td text-center text-ink-muted">No companies yet.</td></tr>}
          {data.companies.map((c) => (
            <tr key={c.id} className="cursor-pointer hover:bg-subtle/50" onClick={() => setOpen(c)}>
              <td className="td font-semibold">{c.name}</td>
              <td className="td"><button className="link" onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(linkFor(c.slug)); toast.success('Link copied') }}>/c/{c.slug}</button></td>
              <td className="td">{c.admin?.name || '—'}<div className="text-xs text-ink-muted">{c.admin?.email}</div></td>
              <td className="td tabular-nums">{c.activePeople} / {c.seats}</td>
              <td className="td"><Pill tone={c.active ? 'ok' : 'bad'}>{c.active ? 'Active' : 'Suspended'}</Pill></td>
            </tr>
          ))}
        </tbody>
      </Table>
      {creating && <NewCompany onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />}
      {open && <Detail company={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); reload() }} />}
    </>
  )
}
