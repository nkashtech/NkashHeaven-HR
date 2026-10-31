import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import api, { company, errorMessage, loginPath } from '../../services/api'
import { AuthShell } from './Login'
import { PasswordChecklist, passwordOk } from './ForcePassword'

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    try {
      await api.post('/auth/forgot-password', { email, company: company.slug })
      setSent(true)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  return (
    <AuthShell title="Forgot password" subtitle="We'll email you a link to choose a new one.">
      {sent ? <p className="text-ink-soft">If that email has an account, a reset link is on its way. The link works for 1 hour.</p> : (
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label" htmlFor="email">Work email</label>
            <input id="email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="btn-primary w-full !py-2.5">Send reset link</button>
        </form>
      )}
      <Link to={loginPath()} className="link mt-4 inline-block">Back to sign in</Link>
    </AuthShell>
  )
}

export function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    try {
      await api.post('/auth/reset-password', { token: params.get('token'), newPassword: password })
      toast.success('Password changed. Please sign in.')
      navigate(loginPath())
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={submit} className="mt-3 space-y-3">
        <div>
          <label className="label" htmlFor="pw">New password</label>
          <input id="pw" type="password" autoComplete="new-password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <PasswordChecklist password={password} />
        <button className="btn-primary w-full !py-2.5" disabled={!passwordOk(password)}>Save password</button>
      </form>
    </AuthShell>
  )
}
