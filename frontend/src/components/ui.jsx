import { Component, useEffect, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Loader2, X } from 'lucide-react'
import { initials } from '../utils/format'
import { API_URL, session } from '../services/api'

export const Spinner = ({ className = '' }) => <Loader2 className={`animate-spin text-ink-muted ${className}`} size={20} />

export const PageLoader = () => <div className="flex items-center justify-center py-24"><Spinner /></div>

export function PageError({ message, onRetry }) {
  return (
    <div className="card text-center py-12">
      <p className="font-semibold">This page could not load</p>
      <p className="text-ink-soft mt-1">{message}</p>
      {onRetry && <button className="btn-outline mt-4" onClick={onRetry}>Try again</button>}
    </div>
  )
}

// One broken page shows this instead of blanking the app. Layout keys it by path, so moving on resets it.
export class ErrorBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <PageError message="Something went wrong on this screen." onRetry={() => window.location.reload()} />
  }
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-ink-soft mt-0.5">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

export function Card({ title, action, className = '', children, ...rest }) {
  return (
    <section className={`card ${className}`} {...rest}>
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-3">
          <h2 className="text-[15px] font-bold">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export const LinkArrow = ({ to, children }) => <Link to={to} className="link inline-flex items-center gap-1 shrink-0">{children}<ArrowRight size={13} /></Link>

export function Kpi({ label, value, sub, tone }) {
  const color = { bad: 'text-bad', warn: 'text-warn', brand: 'text-brand-ink', info: 'text-info', ok: 'text-ok' }[tone] || 'text-ink'
  return (
    <div className="card !p-4 min-w-0">
      <div className="text-xs text-ink-soft truncate">{label}</div>
      <div className={`text-2xl font-bold mt-1 tracking-tight ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-ink-muted mt-0.5">{sub}</div>}
    </div>
  )
}

const TONES = {
  ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', bad: 'bg-bad-soft text-bad', info: 'bg-info-soft text-info', brand: 'bg-brand-soft text-brand-ink', neutral: 'bg-subtle text-ink-soft',
}
export const Pill = ({ tone = 'neutral', children, className = '' }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${TONES[tone]} ${className}`}>{children}</span>
)

const STATUS_TONE = {
  in_progress: 'info', on_time: 'ok', late: 'warn', early: 'warn', edited: 'info', auto: 'warn', absent: 'bad', leave: 'info',
  DRAFT: 'neutral', SUBMITTED: 'brand', PARTLY_APPROVED: 'warn', APPROVED: 'ok', REFUSED: 'bad', CANCELLED: 'neutral',
  SENT: 'warn', OPENED: 'info', ACTIVATED: 'ok', EXPIRED: 'bad', BOUNCED: 'bad', NONE: 'neutral',
  operational: 'ok', degraded: 'warn', down: 'bad', off: 'neutral',
}
export const StatusPill = ({ status, children }) => <Pill tone={STATUS_TONE[status] || 'neutral'}>{children}</Pill>

const AVATAR_TONES = ['bg-brand-soft text-brand-ink', 'bg-info-soft text-info', 'bg-ok-soft text-ok', 'bg-warn-soft text-warn', 'bg-bad-soft text-bad', 'bg-subtle text-ink-soft']
const PRESENCE = { in: 'bg-ok', leave: 'bg-info', offline: 'bg-ink-muted' }

// One download per file, however many times it appears on screen.
const fileUrls = new Map()
export function fileUrl(fileId) {
  if (!fileUrls.has(fileId)) {
    const url = fetch(`${API_URL}/files/${fileId}`, { headers: { Authorization: `Bearer ${session.token}` } })
      .then((r) => { if (!r.ok) throw new Error('File not available'); return r.blob() })
      .then((b) => URL.createObjectURL(b))
    url.catch(() => fileUrls.delete(fileId))
    fileUrls.set(fileId, url)
  }
  return fileUrls.get(fileId)
}

export function AuthedImage({ fileId, alt, className = 'h-full w-full object-cover rounded-full' }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let live = true
    fileUrl(fileId).then((u) => { if (live) setSrc(u) }).catch(() => {})
    return () => { live = false }
  }, [fileId])
  return src ? <img src={src} alt={alt} className={className} /> : null
}

// Photos by name, so any screen that only has someone's name still shows their face. Two people sharing a name get initials.
let photos = new Map()
const watchers = new Set()
export function setPeoplePhotos(people) {
  const seen = new Map()
  people.forEach((p) => seen.set(p.name, seen.has(p.name) ? null : p.photoFileId))
  photos = seen
  watchers.forEach((fn) => fn())
}
const watch = (fn) => { watchers.add(fn); return () => watchers.delete(fn) }

export function Avatar({ name, size = 36, presence, photoFileId }) {
  const known = useSyncExternalStore(watch, () => photos)
  const photo = photoFileId || known.get(String(name || '').replace(' (former employee)', ''))
  const tone = AVATAR_TONES[(name || '').length % AVATAR_TONES.length]
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${tone}`} style={{ width: size, height: size, fontSize: size * 0.34 }}>
      {photo ? <AuthedImage fileId={photo} alt={name} /> : initials(name)}
      {presence && (
        <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card ${presence.dnd ? 'bg-bad' : PRESENCE[presence.status]}`} title={presence.dnd ? 'Do not disturb' : presence.label} />
      )}
    </span>
  )
}

export const Bar = ({ value, max, color = 'rgb(var(--brand-bright))' }) => (
  <div className="h-2 rounded-full bg-subtle overflow-hidden" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
    <div className="h-full rounded-full transition-all" style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%`, background: color }} />
  </div>
)

export function Empty({ children }) {
  return <p className="text-ink-muted text-[13px] py-3">{children}</p>
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center p-4 overflow-y-auto" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`bg-card rounded-2xl shadow-pop w-full ${wide ? 'max-w-2xl' : 'max-w-md'} animate-fade-up`}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-line">
          <h3 className="font-bold text-[15px]">{title}</h3>
          <button className="btn-ghost !p-1.5" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

// Asks for a required reason, used by refusals and edits.
export function ReasonModal({ title, label = 'Reason', confirm = 'Confirm', danger, onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try { await onConfirm(reason) } finally { setBusy(false) }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="reason">{label}</label>
          <textarea id="reason" autoFocus required rows={3} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
          <button className={danger ? 'btn-danger' : 'btn-primary'} disabled={busy || !reason.trim()}>{confirm}</button>
        </div>
      </form>
    </Modal>
  )
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-card overflow-hidden" role="tablist">
      {options.map(([key, label]) => (
        <button key={key} role="tab" aria-selected={value === key} onClick={() => onChange(key)} className={`px-3 py-2 text-[13px] font-semibold transition ${value === key ? 'bg-brand-soft text-brand-ink' : 'text-ink-soft hover:bg-subtle'}`}>{label}</button>
      ))}
    </div>
  )
}

export const Toggle = ({ checked, onChange, label }) => (
  <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-brand' : 'bg-line'}`}>
    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
  </button>
)

export function Field({ label, children, hint }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-ink-muted mt-1">{hint}</p>}
    </div>
  )
}

export function Table({ children, className = '' }) {
  return <div className={`border border-line rounded-xl2 overflow-x-auto bg-card ${className}`}><table className="w-full">{children}</table></div>
}
