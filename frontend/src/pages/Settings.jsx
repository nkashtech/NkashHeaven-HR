import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { applyTheme, useAuth } from '../contexts/AuthContext'
import { useFetch } from '../components/hooks'
import { Card, Field, Modal, PageHeader, Pill, Toggle } from '../components/ui'
import { ago, setDateFormat } from '../utils/format'
import { applyLanguage } from '../i18n'
import api, { errorMessage } from '../services/api'
import { PasswordChecklist, passwordOk } from './auth/ForcePassword'
import { connectCalendar } from './Calendar'

function Security() {
  const { user, refresh } = useAuth()
  const blank = { currentPassword: '', newPassword: '', confirm: '' }
  const [form, setForm] = useState(blank)
  const [enrol, setEnrol] = useState(null)
  const [code, setCode] = useState('')
  const [disabling, setDisabling] = useState(false)
  const [password, setPassword] = useState('')
  const { data, reload } = useFetch('/auth/sessions')
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const fail = (err) => toast.error(errorMessage(err))

  const change = async (e) => {
    e.preventDefault()
    try {
      await api.post('/auth/change-password', form)
      toast.success('Password updated. Other devices were signed out.')
      setForm(blank)
      reload()
    } catch (err) { fail(err) }
  }
  const startEnrol = () => api.post('/auth/2fa/setup').then((r) => setEnrol(r.data)).catch(fail)
  const confirm = async (e) => {
    e.preventDefault()
    try {
      await api.post('/auth/2fa/enable', { code })
      setEnrol(null)
      setCode('')
      toast.success('Two-factor sign-in is on')
      refresh()
    } catch (err) { fail(err) }
  }
  const disable = async (e) => {
    e.preventDefault()
    try {
      await api.post('/auth/2fa/disable', { password })
      setDisabling(false)
      setPassword('')
      refresh()
    } catch (err) { fail(err) }
  }
  return (
    <Card title="Account & security">
      <form onSubmit={change} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Current password"><input type="password" required autoComplete="current-password" className="input" value={form.currentPassword} onChange={set('currentPassword')} /></Field>
          <Field label="New password"><input type="password" required autoComplete="new-password" className="input" value={form.newPassword} onChange={set('newPassword')} /></Field>
          <Field label="Confirm new password"><input type="password" required autoComplete="new-password" className="input" value={form.confirm} onChange={set('confirm')} /></Field>
        </div>
        {form.newPassword && <PasswordChecklist password={form.newPassword} min={user.minPasswordLength} />}
        <button className="btn-primary" disabled={!passwordOk(form.newPassword, user.minPasswordLength) || form.newPassword !== form.confirm}>Update password</button>
      </form>
      <div className="mt-5 flex items-center justify-between gap-3 border-b border-line pb-3">
        <div><div className="text-[13px] font-bold">Two-factor authentication</div><div className="text-xs text-ink-muted">Authenticator app code at sign-in. Required for HR and Super Admin.</div></div>
        <Toggle label="Two-factor authentication" checked={user.twoFactorOn} onChange={(v) => (v ? startEnrol() : setDisabling(true))} />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <h3 className="text-[13px] font-bold">Active sessions</h3>
        <button className="btn-ghost btn-sm" onClick={() => api.delete('/auth/sessions').then(reload).catch(fail)}>Sign out all others</button>
      </div>
      <div className="divide-y divide-line">
        {data?.sessions.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
            <span className="min-w-0 truncate">{(s.userAgent || 'Unknown device').slice(0, 70)} {s.current && <Pill tone="ok">This device</Pill>}</span>
            {s.current ? <span className="text-xs text-ink-muted">Now</span> : <button className="btn-outline btn-sm" onClick={() => api.delete(`/auth/sessions/${s.id}`).then(reload).catch(fail)}>Sign out</button>}
          </div>
        ))}
      </div>
      {enrol && (
        <Modal title="Turn on two-factor sign-in" onClose={() => setEnrol(null)}>
          <form onSubmit={confirm} className="space-y-3">
            <img src={enrol.qr} alt="QR code" className="mx-auto h-44 w-44 rounded-xl border border-line bg-white" />
            <p className="break-all text-xs text-ink-soft">Or enter this key: {enrol.secret}</p>
            <Field label="6-digit code"><input required inputMode="numeric" className="input tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
            <button className="btn-primary w-full">Confirm</button>
          </form>
        </Modal>
      )}
      {disabling && (
        <Modal title="Turn off two-factor sign-in" onClose={() => setDisabling(false)}>
          <form onSubmit={disable} className="space-y-3">
            <Field label="Your password"><input type="password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <button className="btn-danger w-full">Turn off</button>
          </form>
        </Modal>
      )}
    </Card>
  )
}

function Notifications() {
  const { data, setData } = useFetch('/notifications/preferences')
  const save = async (key, patch) => {
    const preferences = data.preferences.map((p) => (p.key === key ? { ...p, ...patch } : p))
    setData({ preferences })
    try {
      await api.put('/notifications/preferences', { preferences: Object.fromEntries(preferences.map((p) => [p.key, p])) })
    } catch (err) { toast.error(errorMessage(err)) }
  }
  return (
    <Card title="Notifications">
      <div className="grid grid-cols-[1fr_60px_60px] gap-y-2 text-[13px]">
        <span className="eyebrow">Event</span><span className="eyebrow text-center">In-app</span><span className="eyebrow text-center">Email</span>
        {data?.preferences.map((p) => [
          <span key={p.key}>{p.label}</span>,
          <span key={`${p.key}a`} className="flex justify-center"><Toggle label={`${p.label} in-app`} checked={p.inApp} onChange={(v) => save(p.key, { inApp: v })} /></span>,
          <span key={`${p.key}e`} className="flex justify-center"><Toggle label={`${p.label} email`} checked={p.email} onChange={(v) => save(p.key, { email: v })} /></span>,
        ])}
      </div>
      <p className="mt-3 text-xs text-ink-muted">Push notifications arrive with the mobile app.</p>
    </Card>
  )
}

function CalendarTab() {
  const { data, reload } = useFetch('/calendar/connections')
  const [params] = useSearchParams()
  useEffect(() => {
    const result = params.get('calendar')
    if (result === 'connected') toast.success('Calendar connected')
    if (result === 'denied') toast('Nothing was connected.')
    if (result === 'error') toast.error('The calendar could not be connected. Please try again.')
  }, [params])
  const remove = async (id) => {
    await api.delete(`/calendar/connections/${id}`).catch((e) => toast.error(errorMessage(e)))
    toast.success('Disconnected. Synced events were deleted.')
    reload()
  }
  return (
    <Card title="Calendar & integrations">
      <p className="mb-3 text-[13px] text-ink-soft">Connect your Google account the same way a phone calendar does. The app reads your calendar, only adds meetings you create here, and your password is never stored here.</p>
      <div className="divide-y divide-line">
        {data?.connections.map((c) => (
          <div key={c.provider} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div>
              <div className="flex items-center gap-2 text-[13px] font-bold">{c.provider === 'GOOGLE' ? 'Google Calendar (Gmail, Workspace)' : 'Outlook / Microsoft 365'}{c.status === 'RECONNECT' && <Pill tone="bad">Reconnect</Pill>}{c.status === 'CONNECTED' && <Pill tone="ok">Connected</Pill>}</div>
              <div className="text-xs text-ink-muted">{c.connected ? `${c.accountEmail || ''}${c.lastSyncAt ? ` · synced ${ago(c.lastSyncAt)}` : ''}` : c.available ? 'Not connected' : 'Waiting for the Super Admin to set this up'}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {c.connected && <button className="btn-outline btn-sm" disabled={c.pushLeave} title="Adds write access to your calendar" onClick={() => connectCalendar(`${c.provider}?write=1`)}>{c.pushLeave ? 'Pushing leave as Out of office' : 'Push approved leave'}</button>}
              {c.status === 'RECONNECT' && <button className="btn-primary btn-sm" onClick={() => connectCalendar(c.provider)}>Reconnect</button>}
              {c.connected ? <button className="btn-outline btn-sm" onClick={() => remove(c.id)}>Disconnect</button> : <button className="btn-primary btn-sm" disabled={!c.available} onClick={() => connectCalendar(c.provider)}>Connect</button>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

const TIMEZONES = ['Africa/Johannesburg', 'Africa/Harare', 'Africa/Lagos', 'Africa/Nairobi', 'Africa/Kinshasa', 'Europe/London', 'UTC']

function Preferences() {
  const { user, refresh } = useAuth()
  const [form, setForm] = useState({ theme: user.theme, language: user.language, timezone: user.timezone, dateFormat: user.dateFormat, showBirthday: user.showBirthday, showPhone: user.showPhone, doNotDisturb: user.doNotDisturb, chatDigest: user.chatDigest })
  const save = async (patch) => {
    const next = { ...form, ...patch }
    setForm(next)
    if (patch.theme) applyTheme(patch.theme)
    if (patch.dateFormat) setDateFormat(patch.dateFormat)
    if (patch.language) applyLanguage(patch.language)
    try {
      await api.put('/settings/preferences', next)
      refresh()
    } catch (err) { toast.error(errorMessage(err)) }
  }
  const Row = ({ title, sub, k }) => (
    <div className="flex items-center justify-between gap-3 border-b border-line py-2.5">
      <div><div className="text-[13px] font-semibold">{title}</div><div className="text-xs text-ink-muted">{sub}</div></div>
      <Toggle label={title} checked={form[k]} onChange={(v) => save({ [k]: v })} />
    </div>
  )
  return (
    <Card title="Preferences">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Theme">
          <select className="input" value={form.theme} onChange={(e) => save({ theme: e.target.value })}><option value="system">Follow my device</option><option value="light">Light</option><option value="dark">Dark</option></select>
        </Field>
        <Field label="Language">
          <select className="input" value={form.language} onChange={(e) => save({ language: e.target.value })}><option value="en">English</option><option value="fr">Français</option></select>
        </Field>
        <Field label="Timezone">
          <select className="input" value={form.timezone} onChange={(e) => save({ timezone: e.target.value })}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</select>
        </Field>
        <Field label="Date format">
          <select className="input" value={form.dateFormat} onChange={(e) => save({ dateFormat: e.target.value })}><option value="dd MMM yyyy">30 Oct 2026</option><option value="yyyy-MM-dd">2026-10-30</option><option value="dd/MM/yyyy">30/10/2026</option></select>
        </Field>
      </div>
      <div className="mt-3">
        <Row title="Show my birthday" sub="Hiding it removes you from Celebrations and the calendar" k="showBirthday" />
        <Row title="Show my phone number" sub="In the company directory" k="showPhone" />
        <Row title="Do not disturb" sub="Shown next to your name in chat" k="doNotDisturb" />
        <Row title="Chat email digest" sub="One hourly summary of what you missed while offline" k="chatDigest" />
      </div>
    </Card>
  )
}

const TABS = [['account', 'Account & security'], ['notifications', 'Notifications'], ['calendar', 'Calendar & integrations'], ['preferences', 'Preferences']]

export default function Settings() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'account'
  return (
    <>
      <PageHeader title="Settings" subtitle="Your account, notifications and connections" />
      <div className="grid gap-4 lg:grid-cols-[230px_1fr]">
        <nav className="card self-start !p-2" aria-label="Settings">
          <div className="eyebrow px-2 py-1.5">Personal</div>
          {TABS.map(([key, label]) => (
            <button key={key} onClick={() => setParams({ tab: key })} className={`block w-full rounded-lg px-3 py-2 text-left text-[13px] font-medium ${tab === key ? 'bg-subtle font-semibold' : 'text-ink-soft hover:bg-subtle/60'}`}>{label}</button>
          ))}
        </nav>
        <div>
          {tab === 'account' && <Security />}
          {tab === 'notifications' && <Notifications />}
          {tab === 'calendar' && <CalendarTab />}
          {tab === 'preferences' && <Preferences />}
        </div>
      </div>
    </>
  )
}

