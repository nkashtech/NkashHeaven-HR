import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { applyBrand, useAuth } from '../../contexts/AuthContext'
import api, { errorMessage } from '../../services/api'
import { Logo } from '../../components/Layout'

export function AuthShell({ step, title, subtitle, children }) {
  return (
    <div className="flex min-h-full gap-3 p-3">
      <div className="hidden flex-1 flex-col justify-between rounded-2xl bg-brand p-10 text-white lg:flex">
        <Logo dark />
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Your workday, in one place.</h1>
          <p className="mt-3 max-w-md text-[15px] text-white/85">Check in, log time, apply for leave, see your meetings and chat with your team.</p>
        </div>
        <div className="text-xs text-white/85">
          <p>Attendance · Timesheets · Leave · Calendar sync · Chat</p>
          <p className="mt-1.5">Protected with encrypted sign-in and optional two-factor authentication</p>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center rounded-2xl bg-panel p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 lg:hidden"><Logo /></div>
          {step && (
            <div className="mb-5 flex gap-1.5" aria-label={`Step ${step} of 3`}>
              {[1, 2, 3].map((n) => <div key={n} className={`h-1 flex-1 rounded-full ${n <= step ? 'bg-brand' : 'bg-subtle'}`} />)}
            </div>
          )}
          <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
          {subtitle && <p className="mb-4 mt-1 text-ink-soft">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  )
}

export default function Login() {
  const { login } = useAuth()
  const { slug } = useParams()
  const navigate = useNavigate()
  const [brand, setBrand] = useState(null)
  const [form, setForm] = useState({ company: '', email: '', password: '', remember: false, code: '' })
  const [needCode, setNeedCode] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [params] = useSearchParams()
  // The welcome email links here with an invite token: only new employees see the temporary-password wording.
  const [invite, setInvite] = useState(null)
  useEffect(() => {
    const token = params.get('invite')
    if (!token) return
    api.get(`/auth/invite/${token}`).then(({ data }) => {
      setInvite(data)
      if (data.valid) setForm((f) => ({ ...f, email: data.email }))
    }).catch(() => {})
  }, [params])
  // Each company's sign-in wears its own colours and name.
  useEffect(() => {
    if (!slug) { applyBrand(null); return }
    api.get(`/public/${slug}/branding`).then(({ data }) => { setBrand(data); applyBrand(data.primaryColor) }).catch(() => setBrand({ missing: true }))
  }, [slug])
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await login({ ...form, company: slug || form.company.trim().toLowerCase() || undefined, code: needCode ? form.code : undefined })
      if (res.twoFactorRequired) setNeedCode(true)
      else navigate(params.get('next') || '/', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell step={invite?.valid ? 1 : null} title={invite?.valid ? `Welcome, ${invite.firstName}` : brand?.name ? `Sign in to ${brand.name}` : 'Sign in'} subtitle={invite?.valid ? 'Enter the temporary password from your email. You will choose your own password next.' : 'Sign in with your work email and password.'}>
      {brand?.missing && <p className="mb-3 rounded-xl bg-bad-soft px-3 py-2 text-[13px] text-bad">We could not find that company. Check your link.</p>}
      {invite && !invite.valid && <p className="mb-3 rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn">{invite.used ? 'This invite was already used. Sign in with the password you chose.' : 'This invite link has expired. Ask HR to resend it.'}</p>}
      <form onSubmit={submit} className="space-y-3">
        {error && <div role="alert" className="rounded-xl bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</div>}
        {!needCode ? (
          <>
            {!slug && (
              <div>
                <label className="label" htmlFor="company">Company code</label>
                <input id="company" className="input" placeholder="e.g. nkashheaven" value={form.company} onChange={set('company')} autoCapitalize="none" />
                <p className="mt-1 text-[11px] text-ink-muted">It's in your company link. The platform owner leaves this empty.</p>
              </div>
            )}
            <div>
              <label className="label" htmlFor="email">Email (username)</label>
              <input id="email" type="email" autoComplete="username" required className="input" value={form.email} onChange={set('email')} />
            </div>
            <div>
              <label className="label" htmlFor="password">{invite?.valid ? 'Temporary password' : 'Password'}</label>
              <input id="password" type="password" autoComplete="current-password" required className="input" placeholder={invite?.valid ? 'Temporary password' : ''} value={form.password} onChange={set('password')} />
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={form.remember} onChange={set('remember')} className="h-4 w-4 accent-brand" />Keep me signed in</label>
              <Link to={slug ? `/c/${slug}/forgot-password` : '/forgot-password'} className="link">Forgot password?</Link>
            </div>
          </>
        ) : (
          <div>
            <label className="label" htmlFor="code">Authenticator code</label>
            <input id="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required className="input tracking-widest" value={form.code} onChange={set('code')} />
          </div>
        )}
        <button className="btn-primary w-full !py-2.5" disabled={busy}>{busy ? 'Signing in…' : needCode ? 'Verify' : 'Sign in'}</button>
        <p className="text-center text-xs text-ink-muted">5 failed attempts lock the account for 15 minutes.</p>
      </form>
    </AuthShell>
  )
}
