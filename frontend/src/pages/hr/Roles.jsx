import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../../contexts/AuthContext'
import { useFetch } from '../../components/hooks'
import { Card, Field, PageError, PageHeader, PageLoader, Pill } from '../../components/ui'
import api, { errorMessage } from '../../services/api'

const fail = (err) => toast.error(errorMessage(err))
const SCOPES = { SELF: 'Only their own records', DEPARTMENT: 'The people they manage', COMPANY: 'The whole company' }

export default function Roles() {
  const { refresh, user } = useAuth()
  const { data, error, reload } = useFetch('/roles')
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState(null)
  useEffect(() => {
    if (!data) return
    const role = data.roles.find((r) => r.id === selected) || data.roles[0]
    setSelected(role.id)
    setForm({ ...role })
  }, [data, selected])
  if (error) return <PageError message={error} onRetry={reload} />
  if (!data || !form) return <PageLoader />
  const groups = [...new Set(data.permissions.map((p) => p.group))]
  // HR edits roles too, but the owner role and company-wide scope stay with the company admin.
  const locked = !user.isOwner && form.isSystem
  const scopes = Object.entries(SCOPES).filter(([k]) => user.isOwner || k !== 'COMPANY' || form.scope === 'COMPANY')
  const toggle = (key) => setForm({ ...form, permissions: form.permissions.includes(key) ? form.permissions.filter((k) => k !== key) : [...form.permissions, key] })
  const save = async () => {
    try {
      await api.patch(`/roles/${form.id}`, form)
      toast.success('Saved. It applies within seconds.')
      await reload()
      refresh()
    } catch (err) { fail(err) }
  }
  const add = async () => {
    try {
      const { data: r } = await api.post('/roles', { name: `New role ${data.roles.length + 1}`, scope: 'SELF', permissions: data.roles.find((x) => x.scope === 'SELF')?.permissions || [] })
      await reload()
      setSelected(r.role.id)
    } catch (err) { fail(err) }
  }
  const remove = async () => {
    try {
      await api.delete(`/roles/${form.id}`)
      setSelected(null)
      reload()
    } catch (err) { fail(err) }
  }
  return (
    <>
      <PageHeader title="Roles" subtitle="Your roles, your names. Each one decides which screens people see and what they can do.">
        <button className="btn-primary" onClick={add}><Plus size={14} />New role</button>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card className="self-start !p-2">
          {data.roles.map((r) => (
            <button key={r.id} onClick={() => setSelected(r.id)} className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px] ${r.id === form.id ? 'bg-subtle font-semibold' : 'hover:bg-subtle/60'}`}>
              <span className="truncate">{r.name}</span><span className="text-xs text-ink-muted">{r.people}</span>
            </button>
          ))}
        </Card>
        <Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Role name"><input className="input" disabled={locked} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Can see data of"><select className="input" disabled={form.isSystem || (!user.isOwner && form.scope === 'COMPANY')} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>{scopes.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <div className="sm:col-span-2"><Field label="Description"><input className="input" disabled={locked} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field></div>
          </div>
          {form.isSystem && <p className="mt-2"><Pill tone="brand">Owner role</Pill> <span className="text-xs text-ink-muted">Always keeps employee and role management, so you can't lock yourselves out. You can rename it, for example to HR if the admin is your HR person.</span></p>}
          {!form.isSystem && form.scope === 'COMPANY' && <p className="mt-2 text-xs text-ink-muted">Sees the whole company. Only the owner role can give people this role or change their accounts.</p>}
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            {groups.map((g) => (
              <div key={g}>
                <h3 className="eyebrow mb-1.5">{g}</h3>
                <div className="space-y-1.5">
                  {data.permissions.filter((p) => p.group === g).map((p) => (
                    <label key={p.key} className="flex items-center gap-2 text-[13px]"><input type="checkbox" disabled={locked} className="h-4 w-4 accent-brand" checked={form.permissions.includes(p.key)} onChange={() => toggle(p.key)} />{p.label}</label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between border-t border-line pt-3">
            {!form.isSystem && (user.isOwner || form.scope !== 'COMPANY') ? <button className="btn-danger" onClick={remove}><Trash2 size={14} />Delete role</button> : <span />}
            {locked ? <span className="text-xs text-ink-muted">Only the company admin can change this role.</span> : <button className="btn-primary" onClick={save}>Save role</button>}
          </div>
        </Card>
      </div>
    </>
  )
}
