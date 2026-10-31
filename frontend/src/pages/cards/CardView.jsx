import { useEffect, useState } from 'react'
import { useFetch } from '../../components/hooks'
import { Avatar } from '../../components/ui'
import api from '../../services/api'

function FileImage({ id, alt, className, style }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let url
    let live = true
    if (id) api.get(`/files/${id}`, { responseType: 'blob' }).then((r) => { if (live) { url = URL.createObjectURL(r.data); setSrc(url) } }).catch(() => {})
    return () => { live = false; if (url) URL.revokeObjectURL(url) }
  }, [id])
  return src ? <img src={src} alt={alt} className={className} style={style} /> : null
}

// Drawn in real millimetres, so what prints is the size the company chose.
export default function CardView({ design: d, person, qr, companyName, scale = 1 }) {
  const mm = (n) => `${n * scale}mm`
  return (
    <div
      className="relative overflow-hidden shadow-pop print:shadow-none" data-employee-card
      style={{ width: mm(d.widthMm), height: mm(d.heightMm), borderRadius: mm(d.radiusMm), background: d.backgroundColor, color: d.textColor, fontSize: `${3.1 * scale}mm` }}
    >
      {d.backgroundImageId && <FileImage id={d.backgroundImageId} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      <div className="absolute inset-x-0 top-0" style={{ height: mm(1.6), background: d.accentColor }} />
      <div className="relative flex h-full flex-col" style={{ padding: mm(4) }}>
        <div className="flex items-center justify-between" style={{ gap: mm(2) }}>
          <div className="min-w-0">
            {d.logoFileId ? <FileImage id={d.logoFileId} alt={companyName} style={{ height: mm(7), maxWidth: mm(30), objectFit: 'contain' }} /> : <div className="truncate font-bold" style={{ fontSize: `${3.6 * scale}mm` }}>{companyName}</div>}
          </div>
          <div className="shrink-0 font-semibold" style={{ color: d.accentColor, fontSize: `${2.5 * scale}mm` }}>{d.title}</div>
        </div>
        <div className="flex min-h-0 flex-1 items-center" style={{ gap: mm(3) }}>
          {d.showPhoto && <Avatar name={person.name} size={Math.round(15 * scale * 3.78)} photoFileId={person.photoFileId} />}
          <div className="min-w-0 flex-1">
            <div className="font-bold leading-tight" style={{ fontSize: `${3.9 * scale}mm` }}>{person.name}</div>
            {d.showJobTitle && person.jobTitle && <div className="truncate" style={{ fontSize: `${2.7 * scale}mm` }}>{person.jobTitle}</div>}
            {d.showDepartment && person.department && <div className="truncate opacity-75" style={{ fontSize: `${2.4 * scale}mm` }}>{person.department}</div>}
            {d.showEmployeeNo && <div className="opacity-75" style={{ fontSize: `${2.4 * scale}mm` }}>{person.employeeNo}</div>}
          </div>
          {qr && <img src={qr} alt="Scan to check in" className="shrink-0 rounded bg-white" style={{ width: mm(d.qrSizeMm), height: mm(d.qrSizeMm) }} />}
        </div>
        {d.footerText && <div className="truncate opacity-75" style={{ fontSize: `${2.2 * scale}mm` }}>{d.footerText}</div>}
      </div>
    </div>
  )
}

export function useMyCard() {
  return useFetch('/cards/me')
}
