import { useState } from 'react'
import toast from 'react-hot-toast'
import { useFetch } from '../../components/hooks'
import { Card, Field, PageError, PageHeader, PageLoader, Pill } from '../../components/ui'
import api, { errorMessage } from '../../services/api'

const LABELS = { apiToken: 'API token', apiKey: 'API key', senderEmail: 'Sender email', senderName: 'Sender name', clientId: 'Client ID', clientSecret: 'Client secret' }
const HELP = {
  brevo: 'Transactional email: welcome emails, approvals and alerts. Without a key, emails print to the server console in development.',
  google: 'Create an OAuth client in Google Cloud with the Calendar API on, and add the redirect URL below.',
  clickup: 'Personal API token used by Projects → Import from ClickUp.',
  microsoft: 'Register an app in Microsoft Entra with Calendars.Read, and add the redirect URL below.',
}

function Provider({ item, canConfigure, callback, onSaved }) {
  const [form, setForm] = useState(item.values)
  const submit = async (e) => {
    e.preventDefault()
    try {
      await api.put(`/system/integrations/${item.provider}`, form)
      toast.success('Saved')
      onSaved()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  return (
    <Card title={item.label} action={<Pill tone={item.configured ? 'ok' : 'warn'}>{item.configured ? 'Configured' : 'Not configured'}</Pill>}>
      <p className="mb-3 text-[13px] text-ink-soft">{HELP[item.provider]}</p>
      <form onSubmit={submit} className="space-y-3">
        {Object.keys(item.values).map((f) => (
          <Field key={f} label={LABELS[f]}>
            <input disabled={!canConfigure} className="input" autoComplete="off" value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} />
          </Field>
        ))}
        {callback && <Field label="Redirect URL"><input readOnly className="input font-mono !text-xs" value={callback} /></Field>}
        {canConfigure && <button className="btn-primary">Save</button>}
      </form>
    </Card>
  )
}

export default function Integrations() {
  const { data, error, reload } = useFetch('/system/integrations')
  if (error) return <PageError message={error} onRetry={reload} />
  if (!data) return <PageLoader />
  return (
    <>
      <PageHeader title="Integrations" subtitle={data.canConfigure ? 'Keys are stored encrypted' : 'Read-only. Only the Super Admin can change these.'} />
      <div className="grid gap-4 lg:grid-cols-3">
        {data.integrations.map((i) => <Provider key={i.provider} item={i} canConfigure={data.canConfigure} callback={data.callbacks[i.provider]} onSaved={reload} />)}
      </div>
    </>
  )
}
