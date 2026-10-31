import { Printer } from 'lucide-react'
import { Card, PageError, PageHeader, PageLoader } from '../../components/ui'
import CardView, { useMyCard } from './CardView'

export default function MyCard() {
  const { data, error, reload } = useMyCard()
  if (error) return <PageError message={error} onRetry={reload} />
  if (!data) return <PageLoader />
  return (
    <>
      <div className="no-print">
        <PageHeader title="My Card" subtitle="Scan it at the kiosk to check in or out">
          <button className="btn-primary" onClick={() => window.print()}><Printer size={14} />Print</button>
        </PageHeader>
      </div>
      <div className="flex justify-center py-6 print:block print:py-0"><CardView {...data} scale={1.3} /></div>
      <Card className="no-print mx-auto mt-4 max-w-xl">
        <p className="text-[13px] text-ink-soft">Show this on your phone or print it. If you lose it, ask HR to reissue it: your old card stops working straight away.</p>
      </Card>
    </>
  )
}
