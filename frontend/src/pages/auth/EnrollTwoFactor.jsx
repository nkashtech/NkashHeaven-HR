import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../../contexts/AuthContext'
import api, { errorMessage } from '../../services/api'
import { AuthShell } from './Login'

export default function EnrollTwoFactor() {
  const { refresh, logout } = useAuth()
  const [setup, setSetup] = useState(null)
  const [code, setCode] = useState('')

  useEffect(() => { api.post('/auth/2fa/setup').then((r) => setSetup(r.data)).catch((e) => toast.error(errorMessage(e))) }, [])

  const submit = async (e) => {
    e.preventDefault()
    try {
      await api.post('/auth/2fa/enable', { code })
      await refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  return (
    <AuthShell title="Turn on two-factor sign-in" subtitle="This is required for HR and Super Admin accounts.">
      {setup && (
        <form onSubmit={submit} className="space-y-3">
          <img src={setup.qr} alt="QR code for your authenticator app" className="mx-auto h-44 w-44 rounded-xl border border-line bg-white" />
          <p className="text-[13px] text-ink-soft">Scan this with your authenticator app, or enter this key: <code className="break-all text-xs">{setup.secret}</code></p>
          <div>
            <label className="label" htmlFor="code">6-digit code</label>
            <input id="code" required inputMode="numeric" autoComplete="one-time-code" className="input tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <button className="btn-primary w-full !py-2.5">Confirm</button>
          <button type="button" className="btn-ghost w-full" onClick={logout}>Sign out</button>
        </form>
      )}
    </AuthShell>
  )
}
