import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarDays, Gift, MessageSquare, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../contexts/AuthContext'
import { useFetch } from '../components/hooks'
import { Avatar, Card, Empty, Modal, PageError, PageHeader, PageLoader, Pill } from '../components/ui'
import { addDays, companyToday, fmtDay, fmtRange, fmtTime } from '../utils/format'
import api, { errorMessage } from '../services/api'

function Availability({ person, onClose }) {
  const { can } = useAuth()
  const today = companyToday()
  const to = addDays(today, 4)
  const { data, error } = useFetch(can('calendar.team_busy') ? `/calendar/team-busy?from=${today}&to=${to}` : null)
  const row = data?.people.find((p) => p.id === person.id)
  return (
    <Modal title={`${person.name}'s availability`} onClose={onClose}>
      <p className="text-[13px]"><b>Now:</b> {person.presence?.label}</p>
      {!can('calendar.team_busy') && <p className="mt-2 text-[13px] text-ink-soft">Busy times are visible to managers and HR.</p>}
      {error && <p className="mt-2 text-[13px] text-bad">{error}</p>}
      {row && (row.busy.length ? (
        <ul className="mt-2 space-y-1 text-[13px]">{row.busy.map((b) => <li key={`${b.start}`} className="rounded-lg bg-subtle px-3 py-1.5">Busy · {fmtTime(b.start)}–{fmtTime(b.end)}</li>)}</ul>
      ) : <p className="mt-2 text-[13px] text-ink-soft">No synced busy blocks in the next 5 days.</p>)}
      {data && !row && <p className="mt-2 text-[13px] text-ink-soft">This person isn't on your team.</p>}
    </Modal>
  )
}

export default function People() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { data: cel, error, reload } = useFetch('/people/celebrations')
  const { data: dir } = useFetch('/people/directory')
  const [q, setQ] = useState('')
  const [dept, setDept] = useState(null)
  const [viewing, setViewing] = useState(null)

  const people = useMemo(() => (dir?.people || []).filter((p) => (!dept || p.departmentId === dept) && `${p.name} ${p.jobTitle}`.toLowerCase().includes(q.toLowerCase())), [dir, q, dept])
  if (error) return <PageError message={error} onRetry={reload} />
  if (!cel) return <PageLoader />

  const message = async (id) => {
    try {
      const { data } = await api.post('/chat/direct', { userId: id })
      navigate(`/chat?c=${data.conversationId}`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const wish = async (id) => {
    try {
      await api.post(`/people/${id}/wish`, {})
      toast.success('Wishes sent')
      reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const hero = cel.today[0]
  return (
    <>
      <PageHeader title="People & Birthdays" subtitle="Celebrate your colleagues and find anyone in the company" />
      <div className="grid gap-4 lg:grid-cols-[1.8fr_1fr]">
        {hero ? (
          <section className="card flex flex-wrap items-center gap-6 !border-brand/20 !bg-brand-soft">
            <Avatar name={hero.name} size={96} photoFileId={hero.photoFileId} />
            <div className="min-w-0">
              <Pill tone="brand" className="!bg-brand !text-white">Birthday today · {fmtDay(companyToday())}</Pill>
              <h2 className="mt-1 text-2xl font-bold">{hero.name}</h2>
              <p className="text-[13px] text-ink-soft">{hero.jobTitle} · {hero.department}{hero.years > 0 ? ` · ${hero.years} years with us` : ''}</p>
              <p className="mt-1 text-[13px]">{hero.wishes} colleague{hero.wishes === 1 ? ' has' : 's have'} sent wishes</p>
              {hero.id !== user.id && (
                <div className="mt-2 flex gap-2">
                  <button className="btn-primary" disabled={hero.wished} onClick={() => wish(hero.id)}><Gift size={14} />{hero.wished ? 'Wishes sent' : 'Send birthday wishes'}</button>
                  <button className="btn-outline" onClick={() => message(hero.id)}><MessageSquare size={14} />Message</button>
                </div>
              )}
              {cel.today.length > 1 && <p className="mt-2 text-xs text-ink-soft">Also today: {cel.today.slice(1).map((p) => p.name).join(', ')}</p>}
            </div>
          </section>
        ) : <Card title="Birthdays"><Empty>No birthdays today.</Empty></Card>}
        <Card title="Upcoming birthdays">
          {!cel.upcoming.length && <Empty>None in the next 30 days.</Empty>}
          <div className="max-h-52 space-y-2 overflow-y-auto">
            {cel.upcoming.map((p) => (
              <div key={p.id} className="flex items-center gap-2.5 text-[13px]"><Avatar name={p.name} size={28} /><span className="flex-1 truncate">{p.name}</span><span className="text-ink-soft">{fmtDay(p.on)}</span></div>
            ))}
          </div>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Work anniversaries">
          {!cel.anniversaries.length && <Empty>None in the next 30 days.</Empty>}
          <div className="divide-y divide-line">
            {cel.anniversaries.slice(0, 5).map((p) => <div key={p.id} className="flex items-center justify-between py-1.5 text-[13px]"><span className="truncate">{p.name}</span><Pill tone="brand">{p.years} year{p.years === 1 ? '' : 's'} · {fmtDay(p.on, 'd MMM')}</Pill></div>)}
          </div>
        </Card>
        <Card title="New joiners">
          {!cel.joiners.length && <Empty>No new joiners.</Empty>}
          <div className="divide-y divide-line">
            {cel.joiners.slice(0, 5).map((p) => (
              <div key={p.id} className="flex justify-between gap-2 py-1.5"><div className="min-w-0"><div className="truncate text-[13px] font-semibold">{p.name}</div><div className="truncate text-xs text-ink-muted">{p.jobTitle} · {p.department}</div></div><span className="shrink-0 text-xs text-ink-soft">{p.upcoming ? 'Starts' : 'Joined'} {fmtRange(p.startDate, p.startDate)}</span></div>
            ))}
          </div>
        </Card>
        <Card title="Your privacy">
          <p className="text-[13px] text-ink-soft">Only the day and month of birthdays are shown, never the year. You can hide your birthday under Settings → Preferences.</p>
          <Link className="link mt-2 inline-block" to="/settings?tab=preferences">Birthday visibility →</Link>
        </Card>
      </div>
      <Card className="mt-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-bold">Directory</h2>
          <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input className="input !pl-9" placeholder="Search name or job title" aria-label="Search directory" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button className={dept ? 'btn-outline' : 'btn bg-brand-soft text-brand-ink'} onClick={() => setDept(null)}>All</button>
          {dir?.departments.map((d) => <button key={d.id} className={dept === d.id ? 'btn bg-brand-soft text-brand-ink' : 'btn-outline'} onClick={() => setDept(d.id)}>{d.name}</button>)}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {people.map((p) => (
            <div key={p.id} className="rounded-xl border border-line p-3">
              <div className="flex items-center gap-2.5">
                <Avatar name={p.name} size={38} presence={p.presence} photoFileId={p.photoFileId} />
                <div className="min-w-0"><Link to={`/people/${p.id}`} className="block truncate text-[13px] font-semibold hover:underline">{p.name}</Link><div className="truncate text-xs text-ink-muted">{p.jobTitle}</div></div>
              </div>
              <div className="mt-2 truncate text-xs text-ink-soft">{p.department} · {p.presence?.status === 'in' ? 'Checked in' : p.presence?.status === 'leave' ? 'On leave' : 'Not checked in'}{p.phone ? ` · ${p.phone}` : ''}</div>
              {p.id !== user.id && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button className="btn-outline btn-sm" onClick={() => message(p.id)}><MessageSquare size={12} />Message</button>
                  <button className="btn-outline btn-sm" onClick={() => setViewing(p)}><CalendarDays size={12} />Availability</button>
                </div>
              )}
            </div>
          ))}
        </div>
        {!people.length && <Empty>Nobody matches that search.</Empty>}
      </Card>
      {viewing && <Availability person={viewing} onClose={() => setViewing(null)} />}
    </>
  )
}
