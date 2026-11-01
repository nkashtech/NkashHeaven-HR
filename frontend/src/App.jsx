import { Suspense, lazy, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { LiveProvider } from './contexts/LiveContext'
import { CallProvider } from './components/Call'
import { company } from './services/api'
import Layout from './components/Layout'
import { PageLoader } from './components/ui'
import Login from './pages/auth/Login'
import { ForgotPassword, ResetPassword } from './pages/auth/PasswordReset'

// Each page is its own download, so signing in doesn't fetch the whole app.
const loaders = []
function page(load, name = 'default') {
  const fetchIt = () => load().then((m) => {
    sessionStorage.removeItem('chunkRetry')
    return { default: m[name] }
  }).catch((err) => {
    // After a deploy the old file names are gone: reload once to pick up the new ones.
    if (sessionStorage.getItem('chunkRetry')) throw err
    sessionStorage.setItem('chunkRetry', '1')
    window.location.reload()
    return new Promise(() => {})
  })
  loaders.push(load)
  return lazy(fetchIt)
}

const Companies = page(() => import('./pages/system/Companies'))
const HrRoles = page(() => import('./pages/hr/Roles'))
const MyCard = page(() => import('./pages/cards/MyCard'))
const Kiosk = page(() => import('./pages/cards/Kiosk'))
const PublicCard = page(() => import('./pages/cards/PublicCard'))
const MeetingInvite = page(() => import('./pages/MeetingInvite'))
const ForcePassword = page(() => import('./pages/auth/ForcePassword'))
const EnrollTwoFactor = page(() => import('./pages/auth/EnrollTwoFactor'))
const SetupWizard = page(() => import('./pages/auth/SetupWizard'))
const Home = page(() => import('./pages/dashboards/Home'))
const Attendance = page(() => import('./pages/Attendance'))
const Timesheets = page(() => import('./pages/Timesheets'))
const Leave = page(() => import('./pages/Leave'))
const Calendar = page(() => import('./pages/Calendar'))
const Chat = page(() => import('./pages/Chat'))
const People = page(() => import('./pages/People'))
const Profile = page(() => import('./pages/Profile'))
const Settings = page(() => import('./pages/Settings'))
const Notifications = page(() => import('./pages/Notifications'))
const TeamApprovals = page(() => import('./pages/team/TeamApprovals'))
const Reports = page(() => import('./pages/team/Reports'))
const Employees = page(() => import('./pages/hr/Employees'))
const ChangeRequests = page(() => import('./pages/hr/ChangeRequests'))
const Policies = page(() => import('./pages/hr/Policies'))
const Audit = page(() => import('./pages/hr/Audit'))
const Health = page(() => import('./pages/system/Health'))
const Integrations = page(() => import('./pages/system/Integrations'))
const SystemSettings = page(() => import('./pages/system/SystemSettings'))
const Projects = page(() => import('./pages/projects/Projects'))
const ProjectDetail = page(() => import('./pages/projects/ProjectDetail'), 'ProjectDetail')
const ProjectTasks = page(() => import('./pages/projects/ProjectDetail'), 'ProjectTasks')
const AllTasks = page(() => import('./pages/projects/ProjectViews'), 'AllTasks')
const ProjectConfiguration = page(() => import('./pages/projects/ProjectViews'), 'ProjectConfiguration')
const ProjectDashboard = page(() => import('./pages/projects/ProjectViews'), 'ProjectDashboard')
const ProjectReporting = page(() => import('./pages/projects/ProjectViews'), 'ProjectReporting')
const RiskRegisterPage = page(() => import('./pages/projects/ProjectViews'), 'RiskRegisterPage')
const PersonProfile = page(() => import('./pages/PersonProfile'))
const Contracts = page(() => import('./pages/hr/Contracts'))
const Payroll = page(() => import('./pages/hr/Payroll'))
const MyPayslips = page(() => import('./pages/hr/Payroll'), 'MyPayslips')
const Appraisals = page(() => import('./pages/Appraisals'))

function Guard({ allow, children }) {
  return allow ? children : <Navigate to="/" replace />
}

function Private() {
  const { user, isSuper, isLead, can } = useAuth()
  // These gates mirror the API, which refuses everything else until they're done.
  if (user.mustChangePassword) return <ForcePassword />
  if (user.mustEnrollTwoFactor && !user.impersonating) return <EnrollTwoFactor />
  if (!user.setupCompleted && !user.impersonating) return <SetupWizard />
  return (
    <LiveProvider>
      <CallProvider>
        <Routes>
          <Route path="kiosk" element={<Guard allow={can('attendance.kiosk')}><Kiosk /></Guard>} />
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="attendance" element={<Guard allow={can('module.attendance')}><Attendance /></Guard>} />
            <Route path="timesheets" element={<Guard allow={can('module.timesheets')}><Timesheets /></Guard>} />
            <Route path="leave" element={<Guard allow={can('module.leave')}><Leave /></Guard>} />
            <Route path="calendar" element={<Guard allow={can('module.calendar')}><Calendar /></Guard>} />
            <Route path="chat" element={<Guard allow={can('module.chat')}><Chat /></Guard>} />
            <Route path="people" element={<Guard allow={can('module.people')}><People /></Guard>} />
            <Route path="people/:id" element={<Guard allow={can('module.people')}><PersonProfile /></Guard>} />
            <Route path="projects" element={<Guard allow={can('module.projects')}><Projects /></Guard>} />
            <Route path="projects/dashboard" element={<Guard allow={can('module.projects')}><ProjectDashboard /></Guard>} />
            <Route path="projects/reporting" element={<Guard allow={can('module.projects')}><ProjectReporting /></Guard>} />
            <Route path="projects/risks" element={<Guard allow={can('module.projects')}><RiskRegisterPage /></Guard>} />
            <Route path="projects/configuration" element={<Guard allow={can('projects.manage')}><ProjectConfiguration /></Guard>} />
            <Route path="projects/:id" element={<Guard allow={can('module.projects')}><ProjectDetail /></Guard>} />
            <Route path="projects/:id/tasks" element={<Guard allow={can('module.projects')}><ProjectTasks /></Guard>} />
            <Route path="tasks" element={<Guard allow={can('module.projects')}><AllTasks /></Guard>} />
            <Route path="payslips" element={<Guard allow={can('module.payslips')}><MyPayslips /></Guard>} />
            <Route path="my-card" element={<Guard allow={can('module.card')}><MyCard /></Guard>} />
            <Route path="appraisals" element={<Guard allow={can('module.appraisals')}><Appraisals /></Guard>} />
            <Route path="profile" element={<Profile />} />
            <Route path="settings" element={<Settings />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="team" element={<Guard allow={isLead}><TeamApprovals /></Guard>} />
            <Route path="reports" element={<Guard allow={can('reports.view')}><Reports /></Guard>} />
            <Route path="hr/roles" element={<Guard allow={can('roles.manage')}><HrRoles /></Guard>} />
            <Route path="hr/employees" element={<Guard allow={can('users.manage')}><Employees /></Guard>} />
            <Route path="hr/contracts" element={<Guard allow={can('contracts.manage')}><Contracts /></Guard>} />
            <Route path="hr/payroll" element={<Guard allow={can('payroll.manage')}><Payroll /></Guard>} />
            <Route path="hr/requests" element={<Guard allow={can('profile.review')}><ChangeRequests /></Guard>} />
            <Route path="hr/policies" element={<Guard allow={can('org.configure') || can('branding.manage')}><Policies /></Guard>} />
            <Route path="hr/audit" element={<Guard allow={can('audit.view')}><Audit /></Guard>} />
            <Route path="system" element={<Guard allow={isSuper}><Health /></Guard>} />
            <Route path="system/companies" element={<Guard allow={isSuper}><Companies /></Guard>} />
            <Route path="system/integrations" element={<Guard allow={isSuper}><Integrations /></Guard>} />
            <Route path="system/settings" element={<Guard allow={isSuper}><SystemSettings /></Guard>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </CallProvider>
    </LiveProvider>
  )
}

// /c/<company>/... : the company's own address. It remembers the company and keeps people on the right one.
function CompanyRoute() {
  const { slug, '*': rest } = useParams()
  const { search } = useLocation()
  const { user, logout } = useAuth()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    company.set(slug)
    setReady(true)
  }, [slug])
  if (!ready) return <PageLoader />
  if (user && user.company?.slug !== slug) {
    logout()
    return <PageLoader />
  }
  if (rest === 'forgot-password') return <ForgotPassword />
  if (rest === 'reset-password') return <ResetPassword />
  if (user) return <Navigate to={rest && rest !== 'login' ? `/${rest}${search}` : '/'} replace />
  if (rest && rest !== 'login') return <Navigate to={`/c/${slug}/login?next=${encodeURIComponent(`/${rest}${search}`)}`} replace />
  return <Login />
}

// Someone arriving from a link, like a call notification, comes back to it after signing in.
function SignInFirst() {
  const { pathname, search } = useLocation()
  const back = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`
  return <Navigate to={`${company.slug ? `/c/${company.slug}/login` : '/login'}${back}`} replace />
}

export default function App() {
  const { user, loading } = useAuth()
  // Once signed in, the other pages download quietly so moving between them is instant.
  useEffect(() => {
    if (!user) return undefined
    const id = setTimeout(() => loaders.forEach((l) => l().catch(() => {})), 1500)
    return () => clearTimeout(id)
  }, [user])
  if (loading) return <PageLoader />
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/card/:token" element={<PublicCard />} />
        <Route path="/meeting-invite/:token" element={<MeetingInvite />} />
        <Route path="/c/:slug/*" element={<CompanyRoute />} />
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={user ? <Private /> : <SignInFirst />} />
      </Routes>
    </Suspense>
  )
}
