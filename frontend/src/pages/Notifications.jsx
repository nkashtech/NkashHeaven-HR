import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLive } from '../contexts/LiveContext'
import { useFetch } from '../components/hooks'
import { Card, Empty, PageError, PageHeader, PageLoader } from '../components/ui'
import { ago } from '../utils/format'
import api from '../services/api'

export default function Notifications() {
  const [group, setGroup] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const { data, error, reload } = useFetch(`/notifications?group=${group}&unread=${unreadOnly}`)
  const { setUnreadBell } = useLive()
  const navigate = useNavigate()
  if (error) return <PageError message={error} onRetry={reload} />
  if (!data) return <PageLoader />
  const open = async (n) => {
    if (!n.readAt) {
      await api.post(`/notifications/${n.id}/read`)
      setUnreadBell((c) => Math.max(0, c - 1))
    }
    if (n.link) navigate(n.link)
    else reload()
  }
  const readAll = async () => {
    await api.post('/notifications/read-all')
    setUnreadBell(0)
    reload()
  }
  return (
    <>
      <PageHeader title="Notifications" subtitle={`${data.unread} unread`}>
        <button className="btn-outline" onClick={readAll} disabled={!data.unread}>Mark all as read</button>
      </PageHeader>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className="input !w-auto font-semibold" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Filter by type">
          <option value="">All types</option>
          {data.groups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="h-4 w-4 accent-brand" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />Unread only</label>
      </div>
      <Card>
        {!data.notifications.length && <Empty>Nothing here.</Empty>}
        <div className="divide-y divide-line">
          {data.notifications.map((n) => (
            <button key={n.id} onClick={() => open(n)} className="flex w-full items-start gap-3 py-3 text-left hover:bg-subtle/50">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-brand'}`} />
              <span className="min-w-0 flex-1">
                <span className={`block text-[13px] ${n.readAt ? '' : 'font-semibold'}`}>{n.title}</span>
                {n.body && <span className="block text-xs text-ink-soft">{n.body}</span>}
              </span>
              <span className="shrink-0 text-xs text-ink-muted">{ago(n.createdAt)}</span>
            </button>
          ))}
        </div>
      </Card>
    </>
  )
}
