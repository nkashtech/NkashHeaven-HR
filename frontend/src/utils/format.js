import { format, parseISO } from 'date-fns'

const COMPANY_TZ = 'Africa/Johannesburg'

// Calendar days travel as yyyy-MM-dd strings. Parsing at noon keeps them on the right day in any timezone.
export const asDate = (s) => parseISO(`${s}T12:00:00`)

// The person's chosen date format replaces the full-date pattern everywhere (SET-01).
const FULL = 'd MMM yyyy'
let preferred = FULL
export const setDateFormat = (f) => { preferred = f === 'dd MMM yyyy' || !f ? FULL : f }
export const fmtDay = (s, f = 'EEE d MMM') => (s ? format(asDate(s), f === FULL ? preferred : f) : '—')
export const fmtLong = (s) => fmtDay(s, 'EEEE, d MMMM yyyy')
export const fmtRange = (a, b) => (a === b ? fmtDay(a, FULL) : `${preferred === FULL ? fmtDay(a, 'd MMM') : fmtDay(a, FULL)} – ${fmtDay(b, FULL)}`)

// Timestamps always show in the company timezone, not the browser's (BR-01).
const zoned = (d, opts, tz = COMPANY_TZ) => new Intl.DateTimeFormat('en-ZA', { timeZone: tz, ...opts }).format(new Date(d))
export const fmtTime = (d, tz) => zoned(d, { hour: '2-digit', minute: '2-digit', hour12: false }, tz)
export const fmtDateTime = (d, tz) => `${zoned(d, { day: 'numeric', month: 'short' }, tz)}, ${fmtTime(d, tz)}`
export const dayOf = (d, tz = COMPANY_TZ) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d))
export const companyToday = () => dayOf(new Date())

export function addDays(s, n) {
  const d = new Date(`${s}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const mondayOf = (s) => addDays(s, -((new Date(`${s}T12:00:00Z`).getUTCDay() + 6) % 7))

export function isoWeek(s) {
  const d = new Date(`${s}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
}

export const pad = (n) => String(n).padStart(2, '0')
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds))
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

// 4.48 -> "4h 29m"
export function hm(hours) {
  if (hours === null || hours === undefined) return '—'
  const sign = hours < 0 ? '-' : ''
  const mins = Math.round(Math.abs(hours) * 60)
  return `${sign}${Math.floor(mins / 60)}h ${pad(mins % 60)}m`
}
// 3.5 -> "3:30"
export function hhmm(hours) {
  const mins = Math.round((hours || 0) * 60)
  return `${Math.floor(mins / 60)}:${pad(mins % 60)}`
}

export const money = (n, currency = 'R') => `${currency} ${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('')
// Short role names for tight spots like the sidebar. Companies name their own roles, so anything else uses its initials.
const ROLE_SHORT = { 'company admin': 'CA', manager: 'MGR', employee: 'EMP', hr: 'HR', 'super admin': 'SA' }
export const roleShort = (name = '') => ROLE_SHORT[name.trim().toLowerCase()] || (name.length <= 4 ? name.toUpperCase() : name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 4))
export const ROLE_LABEL = { EMPLOYEE: 'Employee', MANAGER: 'Manager', ADMIN: 'HR Admin', SUPER_ADMIN: 'Super Admin' }
export const greeting = () => {
  const h = Number(fmtTime(new Date()).slice(0, 2))
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}
export const bytes = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`)
export const ago = (d) => {
  const mins = Math.round((Date.now() - new Date(d)) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`
  return `${Math.round(mins / 1440)} d ago`
}
