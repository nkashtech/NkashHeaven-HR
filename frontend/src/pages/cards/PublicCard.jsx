import { useParams } from 'react-router-dom'
import { BadgeCheck, XCircle } from 'lucide-react'
import { useFetch } from '../../components/hooks'
import { PageLoader } from '../../components/ui'

// What a phone camera opens from a card's QR: confirmation that the person works there.
export default function PublicCard() {
  const { token } = useParams()
  const { data, error, loading } = useFetch(`/public/card/${token}`)
  if (loading && !data) return <PageLoader />
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="card w-full max-w-sm text-center">
        {error || !data ? (
          <><XCircle className="mx-auto text-bad" size={40} /><h1 className="mt-2 text-lg font-bold">This card is not valid</h1></>
        ) : (
          <><BadgeCheck className="mx-auto text-ok" size={40} /><h1 className="mt-2 text-xl font-bold">{data.name}</h1><p className="text-ink-soft">{data.jobTitle}</p><p className="mt-1 text-[13px] font-semibold">{data.company}</p></>
        )}
      </div>
    </div>
  )
}
