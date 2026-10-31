const prisma = require('./prisma');
const { currentCompanyId } = require('./tenant');

// Everything a company can switch on for a role. Screens decide what shows in the menu and the API enforces the same keys.
const PERMISSIONS = [
  { key: 'module.attendance', label: 'Attendance', group: 'Screens' },
  { key: 'module.timesheets', label: 'Log timesheets', group: 'Screens' },
  { key: 'module.leave', label: 'Leave', group: 'Screens' },
  { key: 'module.calendar', label: 'Calendar', group: 'Screens' },
  { key: 'module.chat', label: 'Chat', group: 'Screens' },
  { key: 'module.people', label: 'People & Birthdays', group: 'Screens' },
  { key: 'module.projects', label: 'Projects', group: 'Screens' },
  { key: 'module.appraisals', label: 'Appraisals', group: 'Screens' },
  { key: 'module.payslips', label: 'My Payslips', group: 'Screens' },
  { key: 'module.card', label: 'My Card', group: 'Screens' },
  { key: 'attendance.edit_team', label: 'Edit attendance of people they can see', group: 'Attendance' },
  { key: 'attendance.create_past', label: 'Create attendance for a past date', group: 'Attendance' },
  { key: 'attendance.delete', label: 'Delete attendance', group: 'Attendance' },
  { key: 'attendance.kiosk', label: 'Run the card scanning kiosk', group: 'Attendance' },
  { key: 'timesheets.validate', label: 'Validate timesheets', group: 'Timesheets' },
  { key: 'timesheets.log_for_others', label: 'Log timesheets for other people', group: 'Timesheets' },
  { key: 'leave.approve', label: 'Approve leave', group: 'Leave' },
  { key: 'leave.configure', label: 'Manage leave types and allocations', group: 'Leave' },
  { key: 'users.manage', label: 'Create and archive employees', group: 'People' },
  { key: 'users.assign', label: 'Change role, manager, position and individual access', group: 'People' },
  { key: 'profile.review', label: 'Review profile change requests', group: 'People' },
  { key: 'roles.manage', label: 'Create roles and set their access', group: 'Administration' },
  { key: 'org.configure', label: 'Departments, teams, schedules, holidays, workflows', group: 'Administration' },
  { key: 'branding.manage', label: 'Company theme, logos, email and card designs', group: 'Administration' },
  { key: 'audit.view', label: 'View audit log', group: 'Administration' },
  { key: 'reports.view', label: 'View reports', group: 'Administration' },
  { key: 'projects.create', label: 'Create projects', group: 'Projects' },
  { key: 'projects.manage', label: 'Manage all projects and import them', group: 'Projects' },
  { key: 'contracts.manage', label: 'Manage employee contracts', group: 'Payroll & appraisals' },
  { key: 'payroll.manage', label: 'Run payroll and payslips', group: 'Payroll & appraisals' },
  { key: 'appraisals.manage', label: 'Create appraisals for anyone', group: 'Payroll & appraisals' },
  { key: 'chat.post_announcements', label: 'Post in #announcements', group: 'Chat & calendar' },
  { key: 'chat.export', label: 'Export a conversation with a reason', group: 'Chat & calendar' },
  { key: 'calendar.team_busy', label: "See busy blocks of people they can see", group: 'Chat & calendar' },
  { key: 'calendar.company_events', label: 'Create company-wide events', group: 'Chat & calendar' },
];

const ALL = PERMISSIONS.map((p) => p.key);
const MODULES = ALL.filter((k) => k.startsWith('module.'));
const STAFF = [...MODULES, 'projects.create'];
const APPROVER_KEYS = ['timesheets.validate', 'leave.approve'];
const LEAD = [...STAFF, ...APPROVER_KEYS, 'attendance.edit_team', 'reports.view', 'calendar.team_busy'];

// A starting point for each new company. They can rename, change or delete all of these except the owner role.
// HR sees the whole company like the admin and can edit roles, but only the admin changes the owner role or makes anyone HR.
const STARTER_ROLES = [
  { name: 'Company Admin', description: 'Owns this company in the system', scope: 'COMPANY', isSystem: true, permissions: ALL },
  { name: 'HR', description: 'Runs people, leave and payroll', scope: 'COMPANY', permissions: ALL },
  { name: 'Manager', description: 'Leads a department', scope: 'DEPARTMENT', permissions: [...LEAD, 'projects.manage', 'chat.post_announcements'] },
  { name: 'Employee', description: 'Everyone else', scope: 'SELF', permissions: STAFF },
];

// The owner role always keeps these, so a company can't lock itself out.
const OWNER_LOCKED = ['roles.manage', 'users.manage', 'users.assign'];
const SCOPE_TO_LEVEL = { SELF: 'EMPLOYEE', DEPARTMENT: 'MANAGER', COMPANY: 'ADMIN' };

const cache = new Map();

async function rolesOf(companyId) {
  const hit = cache.get(companyId);
  if (hit && Date.now() - hit.at < 5000) return hit.roles;
  const roles = await prisma.accessRole.findMany();
  cache.set(companyId, { at: Date.now(), roles });
  return roles;
}

const clearPermissionCache = () => cache.clear();

// Leading someone is a relationship, not a role: an Employee can be another employee's manager.
async function leadsPeople(user) {
  const report = await prisma.user.findFirst({
    where: { active: true, id: { not: user.id }, OR: [{ managerId: user.id }, { department: { managerId: user.id } }] },
    select: { id: true },
  });
  return Boolean(report);
}

// A workflow can name anyone as an approver, directly or through their role.
async function namedInWorkflow(user) {
  const workflows = await prisma.workflow.findMany({ where: { active: true }, select: { steps: true } });
  return workflows.some((w) => w.steps.some((s) => (s.kind === 'USER' && Number(s.userId) === user.id) || (s.kind === 'ROLE' && Number(s.roleId) === user.accessRoleId)));
}

// Per-person changes to their role's access: { key: true } adds it, { key: false } takes it away. The owner role is never tweaked.
function withOverrides(role, overrides) {
  if (!role || role.isSystem || !overrides || typeof overrides !== 'object') return role?.permissions || [];
  const keys = new Set(role.permissions);
  for (const [key, on] of Object.entries(overrides)) {
    if (!ALL.includes(key)) continue;
    if (on === true) keys.add(key);
    if (on === false) keys.delete(key);
  }
  return [...keys];
}

async function permissionsOf(user) {
  if (user.role === 'SUPER_ADMIN' || !user.accessRoleId) return [];
  const roles = await rolesOf(user.companyId ?? currentCompanyId());
  const own = withOverrides(roles.find((r) => r.id === user.accessRoleId), user.permissionOverrides);
  // Approvals must not get stuck with someone whose role can't act on them. Everything else stays with the role.
  return (await leadsPeople(user)) || (await namedInWorkflow(user)) ? [...new Set([...own, ...APPROVER_KEYS])] : own;
}

// The owner role can hand out anything, including what it has switched off for itself.
async function isOwner(user) {
  const roles = await rolesOf(user.companyId ?? currentCompanyId());
  return Boolean(roles.find((r) => r.id === user.accessRoleId)?.isSystem);
}

async function can(user, key) {
  return (await permissionsOf(user)).includes(key);
}

async function permissionsFor(user) {
  const held = await permissionsOf(user);
  return Object.fromEntries(ALL.map((k) => [k, held.includes(k)]));
}

module.exports = { PERMISSIONS, ALL, STARTER_ROLES, OWNER_LOCKED, SCOPE_TO_LEVEL, can, isOwner, withOverrides, leadsPeople, namedInWorkflow, permissionsFor, permissionsOf, clearPermissionCache };
