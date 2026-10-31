import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { LiveProvider } from './contexts/LiveContext'
import { company } from './services/api'
import Companies from './pages/system/Companies'
import HrRoles from './pages/hr/Roles'
import MyCard from './pages/cards/MyCard'
import Kiosk from './pages/cards/Kiosk'
import PublicCard from './pages/cards/PublicCard'
import Layout from './components/Layout'
import { PageLoader } from './components/ui'
import Login from './pages/auth/Login'
import { ForgotPassword, ResetPassword } from './pages/auth/PasswordReset'
import ForcePassword from './pages/auth/ForcePassword'
import EnrollTwoFactor from './pages/auth/EnrollTwoFactor'
import SetupWizard from './pages/auth/SetupWizard'
import Home from './pages/dashboards/Home'
import Attendance from './pages/Attendance'
import Timesheets from './pages/Timesheets'
import Leave from './pages/Leave'
import Calendar from './pages/Calendar'
import Chat from './pages/Chat'
import People from './pages/People'
import Profile from './pages/Profile'
import Settings from './pages/Settings'
import Notifications from './pages/Notifications'
import TeamApprovals from './pages/team/TeamApprovals'
import Reports from './pages/team/Reports'
import Employees from './pages/hr/Employees'
import ChangeRequests from './pages/hr/ChangeRequests'
import Policies from './pages/hr/Policies'
import Audit from './pages/hr/Audit'
import Health from './pages/system/Health'
import Integrations from './pages/system/Integrations'
import SystemSettings from './pages/system/SystemSettings'
import Projects from './pages/projects/Projects'
import { ProjectDetail, ProjectTasks } from './pages/projects/ProjectDetail'
import { AllTasks, ProjectConfiguration, ProjectDashboard, ProjectReporting, RiskRegisterPage } from './pages/projects/ProjectViews'
import PersonProfile from './pages/PersonProfile'
import Contracts from './pages/hr/Contracts'
import Payroll, { MyPayslips } from './pages/hr/Payroll'
import Appraisals from './pages/Appraisals'

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
  if (rest && rest !== 'login') return <Navigate to={`/c/${slug}/login?next=/${rest}`} replace />
  return <Login />
}

export default function App() {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  return (
    <Routes>
      <Route path="/card/:token" element={<PublicCard />} />
      <Route path="/c/:slug/*" element={<CompanyRoute />} />
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="*" element={user ? <Private /> : <Navigate to={company.slug ? `/c/${company.slug}/login` : '/login'} replace />} />
    </Routes>
  )
}
