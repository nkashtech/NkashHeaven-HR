import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../../contexts/AuthContext'
import api, { errorMessage } from '../../services/api'
import { AuthShell } from './Login'
import { Field } from '../../components/ui'

// ONB-04: confirm profile, birthday and emergency contact, optional calendar.
export default function SetupWizard() {
  const { refresh } = useAuth()
  const [step, setStep] = useState(1)
  const [profile, setProfile] = useState(null)
  const [form, setForm] = useState({ preferredName: '', phone: '', birthDate: '', emergencyName: '', emergencyRelation: '', emergencyPhone: '' })
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value })

  useEffect(() => {
    api.get('/profile/me').then(({ data }) => {
      setProfile(data.profile)
      setForm((f) => ({ ...f, preferredName: data.profile.preferredName, phone: data.profile.phone, emergencyName: data.profile.emergencyName, emergencyRelation: data.profile.emergencyRelation, emergencyPhone: data.profile.emergencyPhone }))
    })
  }, [])

  const save = async () => {
    try {
      await api.patch('/profile/me', form)
      setStep(step + 1)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const finish = async () => {
    await api.post('/auth/setup-complete')
    await refresh()
  }
  const connect = async (provider) => {
    try {
      await api.post('/auth/setup-complete')
      const { data } = await api.get(`/calendar/connect/${provider}`)
      window.location.href = data.url
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  if (!profile) return null

  const Row = ({ k, v }) => <div className="flex justify-between gap-4 border-b border-line py-2 text-[13px]"><span className="text-ink-soft">{k}</span><span className="font-medium text-right">{v || '—'}</span></div>
  return (
    <AuthShell step={3} title={['Confirm your details', 'Birthday and emergency contact', 'Connect your calendar'][step - 1]} subtitle={`Step ${step} of 3 of your setup`}>
      {step === 1 && (
        <div className="space-y-3">
          <div>
            <Row k="Name" v={profile.name} /><Row k="Position" v={profile.jobTitle} /><Row k="Department" v={profile.department} />
            <Row k="Manager" v={profile.manager} /><Row k="Schedule" v={profile.schedule} />
          </div>
          <p className="text-xs text-ink-muted">Something wrong here? HR can correct it.</p>
          <Field label="Preferred name"><input className="input" value={form.preferredName} onChange={set('preferredName')} /></Field>
          <Field label="Mobile number"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
          <button className="btn-primary w-full" onClick={save}>Continue</button>
        </div>
      )}
      {step === 2 && (
        <div className="space-y-3">
          <Field label="Birthday" hint="Colleagues see the day and month, never the year. You can hide it in Settings.">
            <input type="date" className="input" value={form.birthDate} onChange={set('birthDate')} />
          </Field>
          <Field label="Emergency contact name"><input className="input" value={form.emergencyName} onChange={set('emergencyName')} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Relationship"><input className="input" value={form.emergencyRelation} onChange={set('emergencyRelation')} /></Field>
            <Field label="Phone"><input className="input" value={form.emergencyPhone} onChange={set('emergencyPhone')} /></Field>
          </div>
          <button className="btn-primary w-full" onClick={save}>Continue</button>
        </div>
      )}
      {step === 3 && (
        <div className="space-y-3">
          <p className="text-[13px] text-ink-soft">See your meetings next to your shifts and leave. Read-only access, and you can disconnect at any time.</p>
          <button className="btn-outline w-full" onClick={() => connect('google')}>Connect Google Calendar</button>
          <button className="btn-outline w-full" onClick={() => connect('microsoft')}>Connect Outlook / Microsoft 365</button>
          <button className="btn-primary w-full" onClick={finish}>Finish</button>
        </div>
      )}
    </AuthShell>
  )
}
