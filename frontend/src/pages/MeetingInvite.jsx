import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { CalendarCheck, CalendarX, Clock, MapPin, Video } from 'lucide-react'
import { PageLoader } from '../components/ui'
import api, { errorMessage } from '../services/api'

// Opened from the invitation email, with no sign-in. Accept and Decline in the email land here and answer at once.
export default function MeetingInvite() {
  const { token } = useParams()
  const [params] = useSearchParams()
  const [invite, setInvite] = useState(null)
  const [error, setError] = useState(null)
  const answered = useRef(false)
  const answer = (choice) => api.post(`/public/meeting-invite/${token}`, { answer: choice }).then(({ data }) => setInvite(data)).catch((e) => setError(errorMessage(e)))
  useEffect(() => {
    const choice = params.get('answer')
    if (choice && !answered.current) { answered.current = true; answer(choice); return }
    api.get(`/public/meeting-invite/${token}`).then(({ data }) => setInvite(data)).catch((e) => setError(errorMessage(e)))
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <div className="flex min-h-full items-center justify-center p-6"><div className="card w-full max-w-md text-center"><CalendarX className="mx-auto text-bad" size={36} /><p className="mt-2 font-semibold">{error}</p></div></div>
  if (!invite) return <PageLoader />
  const row = 'flex items-center gap-2 text-[13px]'
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="card w-full max-w-md space-y-3">
        {invite.status !== 'PENDING' && (
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold ${invite.status === 'ACCEPTED' ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}>
            {invite.status === 'ACCEPTED' ? <CalendarCheck size={15} /> : <CalendarX size={15} />}You {invite.status === 'ACCEPTED' ? 'accepted' : 'declined'} this meeting
          </div>
        )}
        <h1 className="text-xl font-bold">{invite.title}</h1>
        <p className="text-[13px] text-ink-soft">Invited by {invite.organiser}</p>
        <div className={row}><Clock size={14} />{invite.when}</div>
        <div className={row}><Video size={14} />{invite.type}</div>
        {invite.location && <div className={row}><MapPin size={14} />{invite.location}</div>}
        {invite.description && <p className="text-[13px] text-ink-soft">{invite.description}</p>}
        {invite.link && <p className="break-all text-[13px]"><b>Meeting link</b><br /><a className="link" href={invite.link}>{invite.link}</a></p>}
        <div className="flex gap-2 pt-1">
          <button className="btn-primary flex-1" disabled={invite.status === 'ACCEPTED'} onClick={() => answer('accept')}>Accept</button>
          <button className="btn-outline flex-1" disabled={invite.status === 'DECLINED'} onClick={() => answer('decline')}>Decline</button>
        </div>
      </div>
    </div>
  )
}
