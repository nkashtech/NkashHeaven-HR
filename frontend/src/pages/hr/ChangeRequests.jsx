import { useState } from 'react'
import { Paperclip } from 'lucide-react'
import toast from 'react-hot-toast'
import { useFetch } from '../../components/hooks'
import { Avatar, Card, Empty, PageError, PageHeader, PageLoader, ReasonModal, Segmented } from '../../components/ui'
import { ago, fmtDateTime } from '../../utils/format'
import api, { download, errorMessage } from '../../services/api'

export default function ChangeRequests() {
  const [status, setStatus] = useState('PENDING')
  const { data, error, reload } = useFetch(`/profile/requests?status=${status}`)
  const { data: changes, reload: reloadChanges } = useFetch('/profile/changes')
  const [rejecting, setRejecting] = useState(null)
  if (error) return <PageError message={error} onRetry={reload} />
  if (!data) return <PageLoader />
  const all = () => { reload(); reloadChanges() }
  const approve = async (id) => {
    try {
      await api.post(`/profile/requests/${id}/approve`, {})
      toast.success('Approved. The new details are live.')
      all()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const reject = async (reason) => {
    try {
      await api.post(`/profile/requests/${rejecting}/reject`, { reason })
      setRejecting(null)
      all()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const seen = async (id) => {
    await api.post(`/profile/changes/${id}/seen`).catch((e) => toast.error(errorMessage(e)))
    reloadChanges()
  }
  return (
    <>
      <PageHeader title="Change Requests" subtitle="Sensitive profile changes wait here. Everything else applies at once and needs only your eye.">
        <Segmented value={status} onChange={setStatus} options={[['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']]} />
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Needs approval">
          {!data.requests.length && <Empty>Nothing here.</Empty>}
          <div className="divide-y divide-line">
            {data.requests.map((r) => (
              <div key={r.id} className="flex gap-3 py-3">
                <Avatar name={r.userName} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold">{r.userName}</div>
                  <div className="mt-1 space-y-0.5">
                    {r.summary.map((s) => <div key={s.field} className="text-xs"><span className="text-ink-soft">{s.label}:</span> {s.oldMasked || 'empty'} → <b>{s.newMasked}</b></div>)}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-muted">{status === 'PENDING' ? ago(r.createdAt) : fmtDateTime(r.decidedAt)}{r.reason ? ` · ${r.reason}` : ''}</div>
                  {r.proofFileId && <button className="link mt-1 inline-flex items-center gap-1" onClick={() => download(`/files/${r.proofFileId}`, 'proof')}><Paperclip size={12} />Proof</button>}
                  {status === 'PENDING' && (
                    <div className="mt-2 flex gap-2">
                      <button className="btn-outline btn-sm" onClick={() => setRejecting(r.id)}>Reject</button>
                      <button className="btn-primary btn-sm" onClick={() => approve(r.id)}>Approve change</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Applied instantly">
          {!changes?.changes.length && <Empty>Nothing new.</Empty>}
          <div className="divide-y divide-line">
            {changes?.changes.map((c) => (
              <div key={c.id} className="flex items-center gap-3 py-2.5">
                <Avatar name={c.userName} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px]"><b>{c.userName}</b> updated {c.field.toLowerCase()}</div>
                  <div className="truncate text-xs text-ink-muted">{ago(c.createdAt)} · {c.oldValue || 'empty'} → {c.newValue || 'empty'}</div>
                </div>
                <button className="btn-outline btn-sm" onClick={() => seen(c.id)}>Mark as seen</button>
              </div>
            ))}
          </div>
        </Card>
      </div>
      {rejecting && <ReasonModal title="Reject this change" confirm="Reject" danger onClose={() => setRejecting(null)} onConfirm={reject} />}
    </>
  )
}
