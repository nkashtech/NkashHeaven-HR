import { Suspense, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity, Banknote, BarChart3, Bell, Building2, CalendarDays, ChevronsUpDown, Clock, FileText, FolderKanban, Gift, Home, IdCard, KeyRound, LogOut, Menu, MessageSquare, Moon, Plug,
  Plane, ScanLine, ScrollText, Settings, Shield, SlidersHorizontal, Star, Sun, Table2, User, UserPlus, Users, Wallet, X,
} from 'lucide-react'
import { applyTheme, useAuth } from '../contexts/AuthContext'
import { useLive } from '../contexts/LiveContext'
import { Avatar, ErrorBoundary, PageLoader } from './ui'
import { useInterval } from './hooks'
import { clock, fmtTime, ROLE_LABEL, roleShort } from '../utils/format'
import api, { API_URL, company, session } from '../services/api'

// Asked once per page load: the login screen needs it before anyone is signed in.
const brandings = new Map()
export const clearBranding = () => { brandings.clear(); window.dispatchEvent(new Event('branding:changed')) }
const loadBranding = (slug) => {
  if (!brandings.has(slug)) brandings.set(slug, fetch(`${API_URL}/public/${slug}/branding`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})))
  return brandings.get(slug)
}

// The browser tab shows the company's logo too.
function setFavicon(href) {
  const link = document.querySelector('link[rel="icon"]')
  if (!link) return
  link.type = href.endsWith('.svg') ? 'image/svg+xml' : ''
  link.href = href
}

export function Logo({ size = 30, dark }) {
  const user = useAuth()?.user
  const slug = user?.company?.isPlatform ? null : user?.company?.slug || company.slug
  const [custom, setCustom] = useState(null)
  const [name, setName] = useState(null)
  useEffect(() => {
    let live = true
    const load = () => {
      if (slug) {
        loadBranding(slug).then((b) => {
          if (!live) return
          const version = Date.now()
          setCustom(b.hasLogo ? `${slug}?v=${version}` : null)
          setFavicon(b.hasLogo ? `${API_URL}/public/${slug}/logo/main?v=${version}` : '/logo.svg')
          setName(b.name || null)
          if (b.name) document.title = b.name
        })
      }
    }
    load()
    window.addEventListener('branding:changed', load)
    return () => { live = false; window.removeEventListener('branding:changed', load) }
  }, [slug])
  return (
    <div className="flex items-center gap-2.5">
      {custom
        ? <img src={`${API_URL}/public/${custom.split('?')[0]}/logo/main?${custom.split('?')[1]}`} alt="" style={{ height: size, maxWidth: 90 }} className="object-contain" />
        : <img src="/logo.svg" alt="" style={{ width: size, height: size }} />}
      <span className="font-bold text-[16px] leading-none tracking-tight">
        {name ? <span className={dark ? 'text-white' : ''}>{name}</span> : <><span className={dark ? 'text-white' : ''}>NkashHeaven</span><span className={dark ? 'text-white' : 'text-brand'}>-HR</span></>}
      </span>
    </div>
  )
}

function Item({ to, icon: Icon, label, badge, end, onClick }) {
  return (
    <NavLink
      to={to} end={end} onClick={onClick}
      className={({ isActive }) => `flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition ${isActive ? 'bg-card text-ink font-semibold shadow-soft' : 'text-ink-soft hover:bg-card/60'}`}
    >
      {({ isActive }) => (
        <>
          <Icon size={16} className={isActive ? 'text-brand' : ''} />
          <span className="flex-1 truncate">{label}</span>
          {badge > 0 && <span className="min-w-[20px] rounded-full bg-brand px-1.5 py-0.5 text-center text-[10px] font-bold text-white">{badge > 99 ? '99+' : badge}</span>}
        </>
      )}
    </NavLink>
  )
}

const Section = ({ label, children }) => (
  <div className="mt-4">
    <div className="eyebrow px-3 mb-1.5">{label}</div>
    <div className="space-y-0.5">{children}</div>
  </div>
)

function Sidebar({ close }) {
  const { user, logout, can, isSuper, isLead } = useAuth()
  const { unreadChat } = useLive()
  const [approvals, setApprovals] = useState(0)
  const [requests, setRequests] = useState(0)
  const navigate = useNavigate()

  useEffect(() => {
    if (isLead && can('leave.approve')) api.get('/approvals').then((r) => { setApprovals(r.data.total - r.data.changeRequests); setRequests(r.data.changeRequests) }).catch(() => {})
  }, [isLead]) // eslint-disable-line react-hooks/exhaustive-deps

  const item = (props) => <Item {...props} onClick={close} />
  const flag = (k) => user.flags?.[k] !== false
  const adminItems = [
    can('users.manage') && { to: '/hr/employees', icon: UserPlus, label: 'Employees' },
    can('roles.manage') && { to: '/hr/roles', icon: KeyRound, label: 'Roles' },
    can('contracts.manage') && { to: '/hr/contracts', icon: FileText, label: 'Contracts' },
    can('payroll.manage') && { to: '/hr/payroll', icon: Banknote, label: 'Payroll' },
    can('profile.review') && { to: '/hr/requests', icon: Bell, label: 'Change Requests', badge: requests },
    (can('org.configure') || can('branding.manage')) && { to: '/hr/policies', icon: Shield, label: 'Company Settings' },
    can('audit.view') && { to: '/hr/audit', icon: ScrollText, label: 'Audit Log' },
    can('attendance.kiosk') && { to: '/kiosk', icon: ScanLine, label: 'Card Kiosk' },
  ].filter(Boolean)
  return (
    <div className="flex h-full flex-col">
      <div className="px-2 pt-1 pb-3"><Link to="/" onClick={close}><Logo /></Link></div>
      {!isSuper && (
        <button onClick={() => { navigate('/profile'); close?.() }} className="flex items-center gap-2.5 rounded-xl border border-line bg-card px-2.5 py-2 text-left shadow-soft">
          <Avatar name={user.name} size={34} photoFileId={user.photoFileId} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{user.preferredName ? `${user.preferredName} ${user.name.split(' ').slice(-1)[0]}` : user.name}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-muted">
              {user.roleName && <span className="shrink-0 rounded bg-brand-soft px-1 py-px text-[10px] font-bold leading-tight text-brand-ink" title={user.roleName}>{roleShort(user.roleName)}</span>}
              <span className="truncate">{user.jobTitle || user.department?.name || user.roleName}</span>
            </span>
          </span>
          <ChevronsUpDown size={14} className="text-ink-muted" />
        </button>
      )}

      <nav className="mt-1 flex-1 overflow-y-auto pb-2" aria-label="Main">
        {isSuper ? (
          <Section label="Platform">
            {item({ to: '/system/companies', icon: Building2, label: 'Companies' })}
            {item({ to: '/system', icon: Activity, label: 'System Health', end: true })}
            {item({ to: '/system/integrations', icon: Plug, label: 'Integrations' })}
            {item({ to: '/system/settings', icon: SlidersHorizontal, label: 'System Settings' })}
          </Section>
        ) : (
          <>
            <Section label="Workspace">
              {item({ to: '/', icon: Home, label: 'Dashboard', end: true })}
              {can('module.attendance') && item({ to: '/attendance', icon: Clock, label: 'Attendance' })}
              {can('module.timesheets') && item({ to: '/timesheets', icon: Table2, label: 'Timesheets' })}
              {can('module.leave') && item({ to: '/leave', icon: Plane, label: 'Leave' })}
              {can('module.calendar') && flag('calendar') && item({ to: '/calendar', icon: CalendarDays, label: 'Calendar' })}
              {can('module.chat') && flag('chat') && item({ to: '/chat', icon: MessageSquare, label: 'Chat', badge: unreadChat })}
              {can('module.people') && flag('celebrations') && item({ to: '/people', icon: Gift, label: 'People & Birthdays' })}
              {can('module.projects') && item({ to: '/projects', icon: FolderKanban, label: 'Projects' })}
              {can('module.appraisals') && item({ to: '/appraisals', icon: Star, label: 'Appraisals' })}
              {can('module.payslips') && item({ to: '/payslips', icon: Wallet, label: 'My Payslips' })}
              {can('module.card') && item({ to: '/my-card', icon: IdCard, label: 'My Card' })}
            </Section>
            {(isLead || can('reports.view')) && (
              <Section label="My team">
                {isLead && item({ to: '/team', icon: Users, label: 'Approvals', badge: approvals })}
                {can('reports.view') && item({ to: '/reports', icon: BarChart3, label: 'Reports' })}
              </Section>
            )}
            {adminItems.length > 0 && <Section label="Administration">{adminItems.map((i) => <div key={i.to}>{item(i)}</div>)}</Section>}
          </>
        )}
      </nav>

      <div className="space-y-0.5 border-t border-line pt-2">
        {!isSuper && item({ to: '/profile', icon: User, label: 'My Profile' })}
        {item({ to: '/settings', icon: Settings, label: 'Settings' })}
        <button onClick={logout} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium text-bad hover:bg-bad-soft"><LogOut size={16} />Logout</button>
      </div>
    </div>
  )
}

// One-click check-in from any page (FRD §7).
function PunchChip() {
  const { attendance, punch, busy, serverNow } = useLive()
  const [, tick] = useState(0)
  useInterval(() => tick((n) => n + 1), attendance?.checkedIn ? 1000 : null)
  if (!attendance) return null
  if (attendance.checkedIn) {
    const seconds = (serverNow() - new Date(attendance.openSince).getTime()) / 1000
    return (
      <button onClick={punch} disabled={busy} className="btn border border-ok/30 bg-ok-soft text-ok" title="Click to check out">
        <span className="h-2 w-2 rounded-full bg-ok" />
        <span className="hidden sm:inline">In since {fmtTime(attendance.openSince)} ·</span>
        <span className="tabular-nums">{clock(seconds)}</span>
        <span className="font-bold">Check out</span>
      </button>
    )
  }
  return <button onClick={punch} disabled={busy} className="btn-primary"><Clock size={14} />Check In</button>
}

function ThemeToggle() {
  const { user, setUser } = useAuth()
  const dark = document.documentElement.classList.contains('dark')
  const flip = () => {
    const theme = dark ? 'light' : 'dark'
    applyTheme(theme)
    setUser({ ...user, theme })
    api.put('/settings/preferences', { theme }).catch(() => {})
  }
  return <button className="btn-outline !p-2" onClick={flip} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
}

function TopBar({ openMenu }) {
  const { unreadChat, unreadBell } = useLive()
  const navigate = useNavigate()
  const { user, can } = useAuth()
  const Dot = ({ n }) => (n > 0 ? <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-brand ring-2 ring-panel" /> : null)
  return (
    <div className="no-print flex items-center justify-between gap-2 px-4 pt-4 sm:px-6">
      <button className="btn-outline !p-2 lg:hidden" onClick={openMenu} aria-label="Open menu"><Menu size={18} /></button>
      <div className="ml-auto flex items-center gap-2">
        {can('module.attendance') && !user.isOwner && <PunchChip />}
        <ThemeToggle />
        {can('module.chat') && user.flags?.chat !== false && (
          <button className="btn-outline relative !p-2" aria-label={`Chat, ${unreadChat} unread`} onClick={() => navigate('/chat')}><MessageSquare size={16} /><Dot n={unreadChat} /></button>
        )}
        <button className="btn-outline relative !p-2" aria-label={`Notifications, ${unreadBell} unread`} onClick={() => navigate('/notifications')}><Bell size={16} /><Dot n={unreadBell} /></button>
      </div>
    </div>
  )
}

function ViewAsBanner() {
  const { user } = useAuth()
  if (!user.impersonating) return null
  const stop = async () => {
    await api.post('/system/impersonate/stop').catch(() => {})
    session.clear()
    window.location.href = '/login'
  }
  return (
    <div className="flex items-center justify-between gap-3 bg-warn-soft px-4 py-2 text-[13px] text-warn">
      <span><b>Viewing as {user.name}.</b> This view is read-only, expires in 30 minutes, and {user.name.split(' ')[0]} has been told.</span>
      <button className="btn-outline btn-sm" onClick={stop}>End and sign out</button>
    </div>
  )
}

export default function Layout() {
  const [menu, setMenu] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => { document.querySelector('main')?.scrollTo(0, 0) }, [pathname])
  return (
    <div className="flex h-full flex-col">
      <ViewAsBanner />
      <div className="flex min-h-0 flex-1 gap-3 p-0 sm:p-3">
        <aside className="no-print hidden w-[232px] shrink-0 rounded-2xl bg-subtle/70 p-3 lg:block"><Sidebar /></aside>
        {menu && (
          <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMenu(false)}>
            <div className="h-full w-[264px] bg-panel p-3" onClick={(e) => e.stopPropagation()}>
              <button className="btn-ghost absolute left-[220px] top-4 !p-1.5" onClick={() => setMenu(false)} aria-label="Close menu"><X size={16} /></button>
              <Sidebar close={() => setMenu(false)} />
            </div>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-panel sm:rounded-2xl">
          <TopBar openMenu={() => setMenu(true)} />
          <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-2 sm:px-6">
            <div className="mx-auto max-w-[1240px] animate-fade-up"><ErrorBoundary key={pathname}><Suspense fallback={<PageLoader />}><Outlet /></Suspense></ErrorBoundary></div>
          </main>
        </div>
      </div>
    </div>
  )
}

