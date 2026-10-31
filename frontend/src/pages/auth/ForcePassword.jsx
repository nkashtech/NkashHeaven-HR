import { useState } from 'react'
import { Check, Circle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../../contexts/AuthContext'
import api, { errorMessage } from '../../services/api'
import { AuthShell } from './Login'

const rules = (p, min = 12) => [
  [`${min}+ characters`, p.length >= min], ['Upper and lower case', /[A-Z]/.test(p) && /[a-z]/.test(p)], ['A number', /\d/.test(p)], ['A symbol', /[^A-Za-z0-9]/.test(p)],
]
export const passwordOk = (p, min) => rules(p, min).every(([, ok]) => ok)

export function PasswordChecklist({ password, min }) {
  return (
    <ul className="space-y-1 text-[13px]">
      {rules(password, min).map(([label, ok]) => (
        <li key={label} className={`flex items-center gap-2 ${ok ? 'text-ok' : 'text-ink-muted'}`}>{ok ? <Check size={14} /> : <Circle size={14} />}{label}</li>
      ))}
    </ul>
  )
}

export default function ForcePassword() {
  const { user, refresh, logout } = useAuth()
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value })
  const ready = passwordOk(form.newPassword, user.minPasswordLength) && form.newPassword === form.confirm && form.currentPassword

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post('/auth/change-password', form)
      await refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthShell step={2} title="Choose your password" subtitle="Your temporary password only works once. Pick your own to continue.">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="cur">Temporary password</label>
          <input id="cur" type="password" required autoComplete="current-password" className="input" value={form.currentPassword} onChange={set('currentPassword')} />
        </div>
        <div>
          <label className="label" htmlFor="new">New password</label>
          <input id="new" type="password" required autoComplete="new-password" className="input" value={form.newPassword} onChange={set('newPassword')} />
        </div>
        <div>
          <label className="label" htmlFor="confirm">Confirm new password</label>
          <input id="confirm" type="password" required autoComplete="new-password" className="input" value={form.confirm} onChange={set('confirm')} />
        </div>
        <PasswordChecklist password={form.newPassword} min={user.minPasswordLength} />
        {form.confirm && form.confirm !== form.newPassword && <p className="text-[13px] text-bad">The two passwords don't match.</p>}
        <button className="btn-primary w-full !py-2.5" disabled={!ready || busy}>Save and continue</button>
        <button type="button" className="btn-ghost w-full" onClick={logout}>Sign out</button>
      </form>
    </AuthShell>
  )
}
