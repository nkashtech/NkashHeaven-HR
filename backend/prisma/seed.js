// Demo data: the people from the wireframes plus enough staff and history to fill every screen.
// Dates are relative to today and generated from a fixed seed. THIS WIPES THE DATABASE.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { encrypt } = require('../lib/crypto');
const { today, toDbDate, zonedToUtc, addDays, mondayOf, eachDay, weekdayKey, monthStart, yearOf, hoursBetween, round2, localTime } = require('../lib/time');
const chat = require('../lib/chat');
const { setFallbackCompany, runAs } = require('../lib/tenant');
const { STARTER_ROLES, SCOPE_TO_LEVEL } = require('../lib/permissions');
const { setupCompany } = require('../lib/company-setup');
const { generateRun } = require('../lib/payroll');

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed: this script wipes the database.');
  process.exit(1);
}

const PASSWORD = 'Nkash@Demo2026!';
const TZ = 'Africa/Johannesburg';
const DOMAIN = 'nkashheaven.co.za';

// Deterministic generator so the data comes out the same every time.
let state = 20261030;
function rand() {
  state = (state + 0x6D2B79F5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (a, b) => a + rand() * (b - a);
const pick = (list) => list[Math.floor(rand() * list.length)];
// Payroll for the last few full months, through the real payslip calculation: older ones paid, the latest published.
async function seedPayroll(months, createdById, day) {
  let end = addDays(monthStart(day), -1);
  const periods = [];
  for (let i = 0; i < months; i += 1) {
    const start = monthStart(end);
    periods.unshift([start, end]);
    end = addDays(start, -1);
  }
  for (const [i, [start, finish]] of periods.entries()) {
    const label = new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(toDbDate(start));
    const run = await prisma.payrollRun.create({ data: { name: `Payroll ${label}`, periodStart: toDbDate(start), periodEnd: toDbDate(finish), createdById } });
    await generateRun(run);
    const stateNow = i === periods.length - 1 ? 'DONE' : 'PAID';
    await prisma.payrollRun.update({ where: { id: run.id }, data: { state: stateNow } });
    await prisma.payslip.updateMany({ where: { runId: run.id }, data: { state: stateNow } });
  }
}

const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(Math.floor(mins % 60)).padStart(2, '0')}`;

async function wipe() {
  const tables = await prisma.$queryRaw`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of tables) await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${t.name ?? t.NAME ?? t.TABLE_NAME}\``);
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
}

const STAFF = {
  Operations: [
    ['Bongani Khoza', 'Warehouse Assistant'], ['Zodwa Ngcobo', 'Stock Clerk'], ['Kagiso Molefe', 'Driver'], ['Sibusiso Zungu', 'Forklift Operator'],
    ['Nomsa Dube', 'Dispatch Clerk'], ['Lindiwe Sithole', 'Receiving Clerk'], ['Pieter Botha', 'Fleet Technician'], ['Thulani Mkhize', 'Driver'],
    ['Refilwe Mokoena', 'Picker'], ['Andile Nxumalo', 'Picker'], ['Yusuf Patel', 'Inventory Analyst'], ['Mandla Cele', 'Security Officer'],
    ['Palesa Tau', 'Packer'], ['Sizwe Hadebe', 'Driver'], ['Precious Radebe', 'Packer'], ['Tshepo Maseko', 'Warehouse Assistant'],
    ['Lebo Mokoena', 'Picker'], ['Jabu Khumalo', 'Driver'], ['Ruan Pretorius', 'Fleet Technician'], ['Nandi Mthethwa', 'Dispatch Clerk'],
  ],
  Sales: [
    ['Busisiwe Mahlangu', 'Sales Executive'], ['Nadia Khan', 'Account Manager'], ['Hendrik Venter', 'Sales Executive'], ['Ntombi Zulu', 'Sales Coordinator'],
    ['Lwazi Gumede', 'Sales Executive'], ['Chantelle Adams', 'Customer Success'], ['Tumi Sebola', 'Inside Sales'], ['Musa Vilakazi', 'Sales Executive'],
    ['Karabo Molete', 'Junior Sales Executive'], ['Megan Daniels', 'Customer Success'], ['Siya Ndaba', 'Inside Sales'],
  ],
  Finance: [['Thando Zulu', 'Accounts Clerk'], ['Kabelo Sithole', 'Accountant'], ['Fatima Ebrahim', 'Payroll Officer'], ['Gugu Mabena', 'Creditors Clerk'], ['Riaan Nel', 'Financial Analyst'], ['Ayesha Moosa', 'Debtors Clerk'], ['Neo Tshabalala', 'Junior Accountant'], ['Imran Desai', 'Payroll Clerk']],
  Technology: [
    ['Ethan Naidoo', 'Senior Developer'], ['Ama Owusu', 'Developer'], ['Sipho Mabuza', 'Junior Developer'], ['Lerato Molefe', 'Junior Developer'],
    ['Daniel Pillay', 'QA Tester'], ['Zinhle Ngubane', 'UI Designer'], ['Thuso Mofokeng', 'DevOps Engineer'],
  ],
  'People & HR': [['Mpho Letsoalo', 'HR Assistant']],
  Management: [['Vusi Ntuli', 'Chief Operating Officer'], ['Marelize Steyn', 'Head of Strategy']],
};

async function main() {
  await wipe();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const day = today(TZ);
  const year = yearOf(day);
  const thisMonday = mondayOf(day);

  // The demo accounts have no authenticator app, so the mandatory-2FA rule starts off here. The product default is on.
  const noTwoFactor = { security: { adminTwoFactorRequired: false } };
  const platform = await prisma.company.create({ data: { name: 'NkashHeaven Platform', slug: 'platform', isPlatform: true, timezone: TZ, settings: noTwoFactor } });
  setFallbackCompany(platform.id);
  await prisma.user.create({
    data: {
      name: 'Super Admin', email: 'superadmin@nkashheaven.co.za', employeeNo: 'SA-0001', role: 'SUPER_ADMIN', passwordHash, jobTitle: 'Platform owner', startDate: toDbDate('2019-02-01'),
      inviteStatus: 'ACTIVATED', setupCompleted: true, profile: { create: {} },
    },
  });

  const main = await prisma.company.create({ data: { name: 'NkashHeaven', slug: 'nkashheaven', timezone: TZ, seats: 120, settings: noTwoFactor } });
  setFallbackCompany(main.id);
  const accessRoles = {};
  for (const r of STARTER_ROLES) accessRoles[r.name] = await prisma.accessRole.create({ data: r });
  const ROLE_NAME = { ADMIN: 'Company Admin', MANAGER: 'Manager', EMPLOYEE: 'Employee' };

  const weekdays = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => [d, { start: '08:00', end: '17:00' }]));
  const standard = await prisma.workSchedule.create({ data: { name: 'Mon–Fri 08:00–17:00', days: weekdays, breakMinutes: 60, hoursPerDay: 8 } });
  const early = await prisma.workSchedule.create({ data: { name: 'Mon–Fri 07:00–16:00', days: Object.fromEntries(Object.keys(weekdays).map((d) => [d, { start: '07:00', end: '16:00' }])), breakMinutes: 60, hoursPerDay: 8 } });

  const holidays = [
    ['01-01', "New Year's Day"], ['03-21', 'Human Rights Day'], ['04-27', 'Freedom Day'], ['05-01', "Workers' Day"], ['06-16', 'Youth Day'],
    ['08-09', "National Women's Day"], ['09-24', 'Heritage Day'], ['12-16', 'Day of Reconciliation'], ['12-25', 'Christmas Day'], ['12-26', 'Day of Goodwill'],
  ];
  await prisma.publicHoliday.createMany({ data: [year, year + 1].flatMap((y) => holidays.map(([md, name]) => ({ date: toDbDate(`${y}-${md}`), name }))) });
  await prisma.publicHoliday.create({ data: { date: toDbDate(`${year}-12-24`), name: 'Year-end office closure', kind: 'OFFICE' } });
  await prisma.publicHoliday.createMany({ data: [{ date: toDbDate('2026-04-03'), name: 'Good Friday' }, { date: toDbDate('2026-04-06'), name: 'Family Day' }], skipDuplicates: true });

  const deptNames = ['Operations', 'Sales', 'Finance', 'Technology', 'People & HR', 'Management'];
  const depts = {};
  for (const name of deptNames) depts[name] = await prisma.department.create({ data: { name } });

  const teams = {};
  for (const [name, dept] of [['Warehouse Crew A', 'Operations'], ['Warehouse Crew B', 'Operations'], ['Software Development', 'Technology'], ['Field Sales', 'Sales'], ['Finance Operations', 'Finance']]) {
    teams[name] = await prisma.team.create({ data: { name, departmentId: depts[dept].id } });
  }

  const leaveTypes = {};
  const typeRows = [
    { key: 'annual', name: 'Annual leave', colour: '#E2744A', accrualPerMonth: 1.25, maxCarryOver: 5, carryExpiry: '06-30', approvalSteps: 'MANAGER_HR' },
    { key: 'sick', name: 'Sick leave', colour: '#3D9A8B', defaultDays: 10, attachmentAfterDays: 2, approvalSteps: 'MANAGER_HR' },
    { key: 'family', name: 'Family responsibility', colour: '#2F62E3', defaultDays: 3, approvalSteps: 'HR' },
    { key: 'study', name: 'Study leave', colour: '#7C3AED', defaultDays: 5, attachmentAfterDays: 1, approvalSteps: 'MANAGER' },
    { key: 'unpaid', name: 'Unpaid leave', colour: '#8A8F98', requiresAllocation: false, approvalSteps: 'MANAGER_HR' },
  ];
  for (const { key, ...t } of typeRows) leaveTypes[key] = await prisma.leaveType.create({ data: t });

  let empNo = 0;
  const makeUser = async (name, role, opts = {}) => {
    empNo += 1;
    const first = name.split(' ')[0].toLowerCase();
    const email = opts.email || `${first}.${name.split(' ').slice(-1)[0].toLowerCase().replace(/[^a-z]/g, '')}@${DOMAIN}`;
    return prisma.user.create({
      data: {
        name, role, accessRoleId: accessRoles[opts.roleName || ROLE_NAME[role]].id, permissionOverrides: opts.permissionOverrides, email, teamId: opts.teamId, employeeNo: `EMP-${String(empNo).padStart(4, '0')}`, passwordHash, jobTitle: opts.jobTitle, departmentId: opts.dept ? depts[opts.dept].id : null,
        managerId: opts.managerId, scheduleId: opts.scheduleId ?? standard.id, startDate: toDbDate(opts.startDate || addDays(day, -Math.floor(between(120, 2500)))),
        inviteStatus: opts.inviteStatus || 'ACTIVATED', activatedAt: new Date(), setupCompleted: true, lastLoginAt: new Date(Date.now() - between(1, 40) * 3600000), invitedAt: opts.invitedAt,
        mustChangePassword: Boolean(opts.mustChangePassword), tempPasswordExpiry: opts.tempPasswordExpiry, salaryBand: pick(['B3', 'C1', 'C2', 'D1']),
      },
    });
  };
  const anniversary = (daysAhead, years) => `${yearOf(addDays(day, daysAhead)) - years}${addDays(day, daysAhead).slice(4)}`;

  const naledi = await makeUser('Naledi Mokoena', 'ADMIN', { jobTitle: 'HR Administrator', email: `naledi@${DOMAIN}`, dept: 'People & HR', managerId: null, startDate: '2020-06-01' });
  // Two HR users: they report to the company admin and look after everyone else.
  const kea = await makeUser('Kea Mahlangu', 'ADMIN', { roleName: 'HR', jobTitle: 'HR Officer', email: `kea@${DOMAIN}`, dept: 'People & HR', managerId: naledi.id });
  const nonhle = await makeUser('Nonhle Shabalala', 'ADMIN', { roleName: 'HR', jobTitle: 'HR Business Partner', email: `nonhle@${DOMAIN}`, dept: 'People & HR', managerId: naledi.id });
  const lerato = await makeUser('Lerato Dlamini', 'MANAGER', { jobTitle: 'Operations Manager', email: `lerato@${DOMAIN}`, dept: 'Operations', managerId: naledi.id, startDate: anniversary(4, 8) });
  const sipho = await makeUser('Sipho Ndlovu', 'MANAGER', { jobTitle: 'Finance Manager', email: `sipho@${DOMAIN}`, dept: 'Finance', managerId: naledi.id });
  const salesMgr = await makeUser('Dineo Kekana', 'MANAGER', { jobTitle: 'Sales Manager', email: `dineo@${DOMAIN}`, dept: 'Sales', managerId: naledi.id });
  const techMgr = await makeUser('Kgomotso Phiri', 'MANAGER', { jobTitle: 'Head of Technology', email: `kgomotso@${DOMAIN}`, dept: 'Technology', managerId: naledi.id });
  await prisma.department.update({ where: { id: depts.Technology.id }, data: { managerId: techMgr.id } });
  await prisma.department.update({ where: { id: depts.Operations.id }, data: { managerId: lerato.id } });
  await prisma.department.update({ where: { id: depts.Finance.id }, data: { managerId: sipho.id } });
  await prisma.department.update({ where: { id: depts.Sales.id }, data: { managerId: salesMgr.id } });
  await prisma.department.update({ where: { id: depts['People & HR'].id }, data: { managerId: naledi.id } });
  const ayanda = await makeUser('Ayanda Mthembu', 'MANAGER', { jobTitle: 'Shift Lead', email: `ayanda@${DOMAIN}`, dept: 'Operations', managerId: lerato.id });
  const crewB = await makeUser('Sandile Mazibuko', 'MANAGER', { jobTitle: 'Shift Lead', dept: 'Operations', managerId: lerato.id, scheduleId: early.id });
  const lead = { managerId: ayanda.id, dept: 'Operations', teamId: teams['Warehouse Crew A'].id };
  const thabo = await makeUser('Thabo Nkosi', 'EMPLOYEE', { ...lead, jobTitle: 'Stock Clerk', email: `thabo@${DOMAIN}`, startDate: '2023-02-14' });
  const priya = await makeUser('Priya Singh', 'EMPLOYEE', { ...lead, jobTitle: 'Logistics Officer', email: `priya@${DOMAIN}` });
  const johan = await makeUser('Johan van Wyk', 'EMPLOYEE', { ...lead, jobTitle: 'Warehouse Coordinator', email: `johan@${DOMAIN}`, startDate: anniversary(17, 4) });

  // An unpaid intern: an Employee whose payslips are switched off for them alone.
  const intern = await makeUser('Lwazi Ntuli', 'EMPLOYEE', { ...lead, jobTitle: 'Unpaid Intern', email: `lwazi@${DOMAIN}`, startDate: addDays(day, -30), permissionOverrides: { 'module.payslips': false } });
  const everyone = [lerato, sipho, salesMgr, techMgr, ayanda, crewB, thabo, priya, johan, naledi, kea, nonhle, intern];
  let index = 0;
  for (const [deptName, people] of Object.entries(STAFF)) {
    for (const [name, jobTitle] of people) {
      const opts = { dept: deptName, jobTitle };
      if (deptName === 'Operations') {
        opts.managerId = index % 3 === 0 || name === 'Zodwa Ngcobo' || name === 'Kagiso Molefe' ? ayanda.id : crewB.id;
        opts.teamId = opts.managerId === ayanda.id ? teams['Warehouse Crew A'].id : teams['Warehouse Crew B'].id;
        if (opts.managerId === crewB.id) opts.scheduleId = early.id;
      } else if (deptName === 'Sales') { opts.managerId = salesMgr.id; opts.teamId = teams['Field Sales'].id; } else if (deptName === 'Finance') { opts.managerId = sipho.id; opts.teamId = teams['Finance Operations'].id; }
      else if (deptName === 'Technology') { opts.managerId = techMgr.id; opts.teamId = teams['Software Development'].id; }
      else if (deptName === 'People & HR') opts.managerId = kea.id;
      else opts.managerId = naledi.id;
      if (name === 'Thando Zulu') { opts.startDate = addDays(day, -11); opts.invitedAt = new Date(Date.now() - 12 * 86400000); }
      if (name === 'Kagiso Molefe') opts.startDate = anniversary(25, 1);
      everyone.push(await makeUser(name, 'EMPLOYEE', opts));
      index += 1;
    }
  }
  const byName = (n) => everyone.find((u) => u.name === n);
  const zodwa = byName('Zodwa Ngcobo');
  const kagiso = byName('Kagiso Molefe');
  const bongani = byName('Bongani Khoza');

  // Invites in each state, for the HR dashboard. These two don't get history.
  const zanele = await makeUser('Zanele Khumalo', 'EMPLOYEE', {
    jobTitle: 'Stock Controller', email: 'zanele.khumalo@gmail.com', dept: 'Operations', managerId: ayanda.id, startDate: addDays(day, 3),
    inviteStatus: 'SENT', invitedAt: new Date(Date.now() - 2 * 3600000), mustChangePassword: true, tempPasswordExpiry: new Date(Date.now() + 70 * 3600000),
  });
  await prisma.user.update({ where: { id: bongani.id }, data: { inviteStatus: 'EXPIRED', mustChangePassword: true, tempPasswordExpiry: new Date(Date.now() - 86400000), invitedAt: new Date(Date.now() - 4 * 86400000), setupCompleted: false, email: 'bongani.k@gmail.com' } });

  // Profiles and birthdays: day and month matter, the year never shows.
  const birthdays = { [johan.id]: 0, [ayanda.id]: 5, [byName('Busisiwe Mahlangu').id]: 13, [sipho.id]: 24, [priya.id]: 32 };
  const banks = ['Capitec', 'FNB', 'Standard Bank', 'Nedbank', 'Absa'];
  const all = [...everyone, zanele];
  for (const u of all) {
    const offset = birthdays[u.id];
    const md = u.id === thabo.id ? '03-17' : offset !== undefined ? addDays(day, offset).slice(5) : `${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`;
    const skipEmergency = rand() < 0.1;
    await prisma.profile.create({
      data: {
        userId: u.id, legalName: u.id === thabo.id ? 'Thabo Sipho Nkosi' : u.name, preferredName: u.id === thabo.id ? 'Thabo' : null,
        birthDate: toDbDate(`${1975 + Math.floor(rand() * 28)}-${md}`), phone: `+27 8${Math.floor(between(2, 4))} 555 ${String(Math.floor(between(100, 999))).padStart(4, '0')}`,
        personalEmail: `${u.name.split(' ')[0].toLowerCase()}.personal@gmail.com`, address: `${Math.floor(between(1, 99))} Mabaso St, Soweto, 1804`,
        emergencyName: skipEmergency ? null : 'Nomsa Nkosi', emergencyRelation: skipEmergency ? null : 'Mother', emergencyPhone: skipEmergency ? null : '+27 71 555 0190',
        idNumberEnc: encrypt(`${Math.floor(between(7001015000000, 9912315999999))}`), taxNumberEnc: encrypt(`${Math.floor(between(1000000000, 3999999999))}`),
        bankName: pick(banks), bankAccountEnc: encrypt(`${Math.floor(between(1000000000, 9999999999))}`), bankAccountType: 'Savings',
      },
    });
  }

  // Leave: carry-over, a grant per type, monthly accruals to date.
  const yearStart = `${year}-01-01`;
  const alloc = [];
  const months = eachDay(yearStart, day).filter((d) => d.endsWith('-01'));
  for (const u of everyone) {
    alloc.push({ userId: u.id, leaveTypeId: leaveTypes.annual.id, days: 2.5, kind: 'CARRY_OVER', periodStart: toDbDate(yearStart), periodEnd: toDbDate(`${year}-06-30`), note: `Carried over from ${year - 1}` });
    for (const m of months) alloc.push({ userId: u.id, leaveTypeId: leaveTypes.annual.id, days: 1.25, kind: 'ACCRUAL', periodStart: toDbDate(m), periodEnd: toDbDate(addDays(m, 27)), note: 'Monthly accrual' });
    for (const key of ['sick', 'family', 'study']) {
      alloc.push({ userId: u.id, leaveTypeId: leaveTypes[key].id, days: leaveTypes[key].defaultDays, kind: 'GRANT', periodStart: toDbDate(yearStart), periodEnd: toDbDate(`${year}-12-31`), note: `${year} allocation` });
    }
  }
  await prisma.leaveAllocation.createMany({ data: alloc });

  const nextWeekday = (d) => (['sat', 'sun'].includes(weekdayKey(d)) ? nextWeekday(addDays(d, 1)) : d);
  const makeLeave = (user, type, from, to, days, state, extra = {}) => prisma.leaveRequest.create({
    data: {
      userId: user.id, leaveTypeId: leaveTypes[type].id, dateFrom: toDbDate(from), dateTo: toDbDate(to), days, state, reason: extra.reason || null, refuseReason: extra.refuseReason || null,
      step1ById: ['PARTLY_APPROVED', 'APPROVED'].includes(state) ? user.managerId : null, finalById: state === 'APPROVED' ? naledi.id : null,
      step1At: ['PARTLY_APPROVED', 'APPROVED'].includes(state) ? new Date() : null, finalAt: state === 'APPROVED' ? new Date() : null, halfDay: Boolean(extra.halfDay),
    },
  });
  const inTwoWeeks = nextWeekday(addDays(day, 18));
  await makeLeave(thabo, 'annual', inTwoWeeks, addDays(inTwoWeeks, 2), 3, 'PARTLY_APPROVED', { reason: 'Family trip' });
  await makeLeave(thabo, 'sick', '2026-10-06', '2026-10-06', 1, 'APPROVED');
  await makeLeave(thabo, 'family', '2026-08-14', '2026-08-14', 1, 'REFUSED', { refuseReason: 'Overlaps stock take' });
  await makeLeave(thabo, 'annual', '2026-04-07', '2026-04-09', 3, 'APPROVED');
  await makeLeave(thabo, 'annual', '2026-07-17', '2026-07-17', 0.5, 'APPROVED', { halfDay: true });
  const priyaBack = nextWeekday(addDays(day, 2));
  await makeLeave(priya, 'annual', addDays(thisMonday, -7), addDays(priyaBack, -1), 6, 'APPROVED', { reason: 'Annual leave' });
  await makeLeave(johan, 'sick', addDays(inTwoWeeks, -1), inTwoWeeks, 2, 'SUBMITTED', { reason: 'Medical procedure' });
  await makeLeave(zodwa, 'annual', nextWeekday(addDays(day, 10)), nextWeekday(addDays(day, 10)), 1, 'SUBMITTED');
  await makeLeave(byName('Nomsa Dube'), 'unpaid', nextWeekday(addDays(day, 7)), nextWeekday(addDays(day, 7)), 1, 'PARTLY_APPROVED');
  for (const u of everyone.filter((x) => rand() < 0.3 && x.id !== thabo.id && x.id !== priya.id)) {
    const from = nextWeekday(addDays(day, -Math.floor(between(30, 180))));
    await makeLeave(u, 'annual', from, addDays(from, 1), 2, 'APPROVED');
  }

  // Attendance and timesheets for the last eight weeks.
  const projectStages = {};
  for (const [sequence, name] of ['Implementation Projects', 'Support', 'Initiation', 'Development', 'Internal'].entries()) {
    projectStages[name] = await prisma.projectStage.create({ data: { name, sequence } });
  }
  const projects = [];
  const projectRows = [
    ['Warehouse Upgrade', 'Operations', ['Stock count', 'Racking install', 'Bay layout'], 'Implementation Projects', lerato, 1600, 'on_track', 'Bidvest Logistics'],
    ['Client Onboarding', 'Sales', ['Site visits', 'Contracts', 'Handover'], 'Implementation Projects', salesMgr, 700, 'at_risk', 'Masakhane Foods'],
    ['Fleet Maintenance', 'Operations', ['Vehicle checks', 'Repairs'], 'Support', lerato, 1200, 'off_track', null],
    ['Month-end Close', 'Finance', ['Reconciliations', 'Reporting'], 'Support', sipho, 0, 'on_track', null],
    ['Staff App Rollout', 'Technology', ['Requirements', 'Build', 'Testing'], 'Development', techMgr, 2000, 'on_track', null],
    ['Customer Portal', 'Technology', ['Design', 'API', 'Release'], 'Development', techMgr, 900, 'at_risk', 'Masakhane Foods'],
    ['New Branch Durban', 'Operations', ['Site selection', 'Lease'], 'Initiation', lerato, 2000, 'on_hold', null],
    ['Internal', null, ['Training', 'Meetings', 'Admin'], 'Internal', naledi, 0, 'on_track', null],
  ];
  for (const [name, dept, tasks, stage, manager, allocatedHours, health, customer] of projectRows) {
    const project = await prisma.project.create({
      data: {
        name, departmentId: dept ? depts[dept].id : null, stageId: projectStages[stage].id, managerId: manager.id, createdById: manager.id, allocatedHours, health, customer,
        plannedStart: toDbDate(addDays(day, -60)), plannedEnd: toDbDate(addDays(day, 90)),
        taskStages: { create: [['To Do', false], ['In Progress', false], ['Review', false], ['Done', true]].map(([n, isDone], sequence) => ({ name: n, isDone, sequence })) },
      },
      include: { taskStages: true },
    });
    const created = [];
    for (const [i, t] of tasks.entries()) {
      created.push(await prisma.task.create({ data: { projectId: project.id, name: t, stageId: project.taskStages[i % 4].id, createdById: manager.id, plannedHours: 20, deadline: toDbDate(addDays(day, i * 9 - 5)), priority: i === 0 } }));
    }
    projects.push({ ...project, tasks: created });
    await prisma.chatterEntry.create({ data: { entity: 'project', entityId: project.id, authorId: manager.id, kind: 'TRACKING', body: 'Project created' } });
  }
  await prisma.riskItem.create({ data: { projectId: projects[0].id, kind: 'RISK', title: 'Supplier delay on racking', severity: 'HIGH', ownerId: lerato.id, createdById: lerato.id, dueDate: toDbDate(addDays(day, 10)) } });
  await prisma.riskItem.create({ data: { projectId: projects[1].id, kind: 'ISSUE', title: 'Client contract still unsigned', severity: 'MEDIUM', ownerId: salesMgr.id, createdById: salesMgr.id } });
  await prisma.activity.create({ data: { entity: 'project', entityId: projects[0].id, assigneeId: lerato.id, summary: 'Review stock count plan', dueDate: toDbDate(addDays(day, 2)), createdById: lerato.id } });
  const internal = projects.find((x) => x.name === 'Internal');
  const clientOnboarding = projects[1];
  const staff = everyone;
  const schedules = new Map([[standard.id, standard], [early.id, early]]);
  const approved = await prisma.leaveRequest.findMany({ where: { state: 'APPROVED' } });
  const onLeave = (id, d) => approved.some((r) => r.userId === id && r.dateFrom <= toDbDate(d) && r.dateTo >= toDbDate(d));
  const holidayDates = new Set((await prisma.publicHoliday.findMany()).map((x) => x.date.toISOString().slice(0, 10)));

  const startFrom = addDays(thisMonday, -56);
  const attendance = [];
  const lines = [];
  const nowMs = Date.now();
  for (const u of staff) {
    if (u.id === naledi.id) continue; // The company admin doesn't clock in.
    const schedule = schedules.get(u.scheduleId);
    const startMin = schedule.id === early.id ? 7 * 60 : 8 * 60;
    const userStart = u.startDate.toISOString().slice(0, 10);
    const myProjects = projects.filter((p) => !p.departmentId || p.departmentId === u.departmentId);
    const mine = [pick(myProjects), internal, pick(myProjects)].map((p) => ({ projectId: p.id, taskId: pick(p.tasks).id }));
    if (u.id === thabo.id) {
      mine[0] = { projectId: projects[0].id, taskId: projects[0].tasks[0].id };
      mine[1] = { projectId: clientOnboarding.id, taskId: clientOnboarding.tasks[0].id };
      mine[2] = { projectId: internal.id, taskId: internal.tasks[0].id };
    }
    for (const d of eachDay(startFrom, day)) {
      if (d < userStart || !schedule.days[weekdayKey(d)] || holidayDates.has(d) || onLeave(u.id, d)) continue;
      const isToday = d === day;
      if (u.id === kagiso.id && (d === day || d === addDays(day, -1))) continue;
      if (u.id === thabo.id && isToday) continue; // Thabo is the check-in demo: he starts today checked out.
      if (!isToday && rand() < 0.015) continue;
      const late = u.id === zodwa.id ? (isToday || rand() < 0.15) : rand() < 0.05;
      const inMin = startMin + (u.id === zodwa.id && isToday ? 23 : late ? between(11, 40) : between(-15, 8));
      const outMin = startMin + 9 * 60 + between(-5, 35);
      const checkIn = zonedToUtc(d, hhmm(inMin), TZ);
      if (isToday && checkIn.getTime() > nowMs) continue;
      if (isToday) {
        attendance.push({ userId: u.id, date: toDbDate(d), checkIn, createdAt: checkIn, openUserId: u.id, lateMinutes: late ? Math.round(inMin - startMin) : 0 });
        continue;
      }
      const auto = rand() < 0.008 || (u.id === thabo.id && d === addDays(thisMonday, 0) && thisMonday !== day);
      const edited = !auto && rand() < 0.02;
      const checkOut = auto ? zonedToUtc(d, schedule.id === early.id ? '20:00' : '21:00', TZ) : zonedToUtc(d, hhmm(outMin), TZ);
      const worked = hoursBetween(checkIn, checkOut);
      const lateMinutes = late ? Math.round(inMin - startMin) : 0;
      attendance.push({
        userId: u.id, date: toDbDate(d), checkIn, createdAt: checkIn, checkOut, workedHours: worked, extraHours: round2(worked - 1 - 8), lateMinutes,
        isEdited: edited, autoClosed: auto, source: auto ? 'AUTO' : 'BUTTON', reviewedAt: auto && d < addDays(thisMonday, -7) ? new Date() : null,
      });
      if (u.role === 'ADMIN' || d >= day) continue;
      const age = (toDbDate(thisMonday) - toDbDate(mondayOf(d))) / 86400000;
      const lineState = age > 7 ? 'VALIDATED' : 'DRAFT';
      const total = u.id === zodwa.id ? 7 : Math.round(between(6.5, 8) * 2) / 2;
      const a = Math.round(between(3, total - 1.5) * 2) / 2;
      const b = Math.round(between(0.5, total - a) * 2) / 2;
      [[mine[0], a], [mine[1], b], [mine[2], round2(total - a - b)]].forEach(([row, hours]) => {
        if (hours > 0) lines.push({ ...row, userId: u.id, date: toDbDate(d), hours, state: lineState, validatedById: lineState === 'VALIDATED' ? u.managerId : null });
      });
    }
  }
  await prisma.attendance.createMany({ data: attendance });
  await prisma.timesheetLine.createMany({ data: lines, skipDuplicates: true });

  // One edited record with its trail, as on the My Attendance wireframe.
  const editable = await prisma.attendance.findFirst({ where: { userId: thabo.id, isEdited: false, autoClosed: false, checkOut: { not: null }, date: { lt: toDbDate(day) } }, orderBy: { date: 'desc' } });
  if (editable) {
    const newOut = zonedToUtc(editable.date.toISOString().slice(0, 10), '16:30', TZ);
    await prisma.attendance.update({ where: { id: editable.id }, data: { checkOut: newOut, workedHours: hoursBetween(editable.checkIn, newOut), isEdited: true } });
    await prisma.attendanceEdit.create({ data: { attendanceId: editable.id, editorId: thabo.id, field: 'check-out', oldValue: localTime(editable.checkOut, TZ), newValue: '16:30', reason: 'Forgot to check out after meeting' } });
  }

  // Contracts, payroll and appraisals
  const wageOf = { MANAGER: 62000, ADMIN: 45000, EMPLOYEE: 22000 };
  for (const u of everyone.filter((x) => x.id !== intern.id)) {
    await prisma.contract.create({
      data: {
        userId: u.id, reference: `${u.employeeNo}/C1`, jobTitle: u.jobTitle, startDate: u.startDate, wage: wageOf[u.role] + Math.round(rand() * 8) * 500, state: 'RUNNING', createdById: naledi.id,
        probationEnd: u.id === byName('Thando Zulu').id ? toDbDate(addDays(day, 25)) : null,
        workPermitNumber: u.id === byName('Yusuf Patel').id ? 'WP-448120' : null, workPermitExpiry: u.id === byName('Yusuf Patel').id ? toDbDate(addDays(day, 50)) : null,
      },
    });
  }
  await prisma.salaryRule.createMany({
    data: [
      { code: 'TRANSPORT', name: 'Transport allowance', category: 'ALLOWANCE', amountType: 'FIXED', amount: 1500, sequence: 1 },
      { code: 'MEDICAL', name: 'Medical aid (employee)', category: 'DEDUCTION', amountType: 'FIXED', amount: 1800, sequence: 1 },
      { code: 'PENSION', name: 'Pension fund', category: 'DEDUCTION', amountType: 'PERCENT_BASIC', amount: 7.5, sequence: 2 },
    ],
  });
  await seedPayroll(3, naledi.id, day);
  await prisma.appraisal.create({ data: { userId: thabo.id, managerId: lerato.id, deadline: toDbDate(addDays(day, 14)), state: 'PENDING', employeeFeedback: 'What went well this period?\n\nWhat was hard, and what support would help?', managerFeedback: 'Strengths shown this period:\n\nAreas to improve:', createdById: naledi.id } });
  await prisma.appraisalGoal.create({ data: { userId: thabo.id, title: 'Reduce stock count variance below 1%', progress: 60, deadline: toDbDate(addDays(day, 60)), createdById: lerato.id } });

  await prisma.missedDayRequest.create({ data: { userId: byName('Nomsa Dube').id, date: toDbDate(nextWeekday(addDays(day, -6))), note: 'Network was down at the gate, confirmed by manager' } }).catch(() => {});

  // HR inbox
  await prisma.profileChange.createMany({
    data: [
      { userId: thabo.id, actorId: thabo.id, field: 'Mobile number', oldValue: '+27 82 555 0100', newValue: '+27 82 555 0143' },
      { userId: priya.id, actorId: priya.id, field: 'Home address', oldValue: '3 Vilakazi St, Soweto', newValue: '22 Long St, Johannesburg' },
    ],
  });
  await prisma.changeRequest.create({
    data: {
      userId: thabo.id, summary: [{ field: 'bankName', label: 'Bank', oldMasked: 'Capitec', newMasked: 'FNB' }, { field: 'bankAccount', label: 'Account number', oldMasked: '••••••4471', newMasked: '••••••9021' }],
      payloadEnc: encrypt(JSON.stringify({ bankName: 'FNB', bankAccount: '6281009021' })),
    },
  });

  // Calendar: meetings created in NkashHeaven-HR. Google and Outlook accounts connect through real OAuth, so none are faked here.
  const event = (title, date, from, to, extra) => prisma.companyEvent.create({ data: { title, startAt: zonedToUtc(date, from, TZ), endAt: zonedToUtc(date, to, TZ), createdById: naledi.id, ...extra } });
  const ops = { audience: 'DEPARTMENT', departmentId: depts.Operations.id };
  await event('Shift handover', day, '14:00', '14:30', { ...ops, location: 'Bay 3' });
  await event('Stock count planning', day, '15:30', '16:00', { ...ops, meetingUrl: 'https://meet.google.com/new' });
  await event('Fire safety training', nextWeekday(addDays(day, 6)), '13:00', '14:30', { ...ops, location: 'Training room', description: 'Scheduled by HR for all Operations staff' });
  await event('Payroll cut-off', nextWeekday(addDays(day, 7)), '09:00', '09:30', { audience: 'COMPANY' });
  for (let i = 1; i <= 5; i += 1) await event('Daily stand-up', nextWeekday(addDays(day, i)), '09:00', '09:15', { ...ops, meetingUrl: 'https://meet.google.com/new' });

  // Chat
  await chat.ensureCompanyChannels();
  for (const dept of Object.values(depts)) await chat.ensureDepartmentChannel(dept);
  for (const u of all) await chat.syncUserChannels(u.id);
  const opsChannel = await prisma.conversation.findFirst({ where: { departmentId: depts.Operations.id } });
  const announce = await prisma.conversation.findFirst({ where: { channelKind: 'ANNOUNCEMENTS' } });
  const general = await prisma.conversation.findFirst({ where: { channelKind: 'GENERAL' } });
  const at = (h, m) => zonedToUtc(day, hhmm(h * 60 + m), TZ);
  const msgs = [
    [opsChannel.id, lerato.id, 'Morning team. Stock count moves to Thursday because of the supplier delay.', at(8, 5)],
    [opsChannel.id, ayanda.id, 'Noted. I will update the roster for Thursday and share it here by lunch.', at(8, 12)],
    [opsChannel.id, ayanda.id, 'Roster for next week is pinned. Thabo and Johan on bay 3 please.', at(8, 40)],
    [announce.id, naledi.id, 'October timesheets are due Friday 15:00.', at(7, 0)],
    [announce.id, naledi.id, 'Fire safety training next Thursday at 13:00. It is on your calendar.', at(7, 30)],
    [general.id, naledi.id, 'Welcome to NkashHeaven-HR chat. Please keep work conversations here.', at(6, 45)],
  ];
  for (const [conversationId, senderId, body, createdAt] of msgs) {
    await prisma.message.create({ data: { conversationId, senderId, body, createdAt } });
    await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: createdAt } });
  }
  const pin = await prisma.message.findFirst({ where: { conversationId: opsChannel.id, body: { contains: 'Roster' } } });
  await prisma.message.update({ where: { id: pin.id }, data: { pinnedAt: new Date(), pinnedById: ayanda.id } });
  const dm = await chat.directConversation(lerato.id, thabo.id);
  await prisma.message.create({ data: { conversationId: dm.id, senderId: lerato.id, body: 'Thabo, please check the Monday record: it was auto closed at 21:00.', createdAt: at(8, 20) } });
  await prisma.conversation.update({ where: { id: dm.id }, data: { lastMessageAt: at(8, 20) } });
  await chat.botConversation(thabo.id);
  await chat.botMessage(thabo.id, 'Welcome to NkashHeaven-HR. Approvals, reminders and birthday wishes land here.', '/');

  await prisma.notification.createMany({
    data: [
      { userId: thabo.id, type: 'attendance.auto_checkout', title: 'You were automatically checked out', body: 'Your Monday record was closed at 21:00. Please correct it if that is wrong.', link: '/attendance' },
      { userId: thabo.id, type: 'approvals.leave', title: 'Your manager approved your leave', body: 'It now goes to HR.', link: '/leave' },
      { userId: naledi.id, type: 'profile.change_request', title: 'Thabo Nkosi requested a change to bank, account number', body: 'Needs your approval before it takes effect.', link: '/hr/requests' },
      { userId: naledi.id, type: 'profile.updated', title: 'Thabo Nkosi updated mobile number', body: 'Mobile number: +27 82 555 0100 → +27 82 555 0143', link: '/hr/requests' },
      { userId: lerato.id, type: 'approvals.leave', title: "Thabo Nkosi's leave needs final approval", link: '/team' },
      { userId: ayanda.id, type: 'approvals.leave', title: 'Johan van Wyk requested leave', link: '/team' },
    ],
  });

  // A second company, to show separation: its own people, address, roles and blue theme.
  const blue = await prisma.company.create({
    data: { name: 'Bluewave Logistics', slug: 'bluewave', timezone: TZ, seats: 25, settings: { ...noTwoFactor, branding: { primaryColor: '#1D4ED8', address: 'Durban, South Africa' }, card: { accentColor: '#1D4ED8', title: 'Bluewave ID' } } },
  });
  await setupCompany(blue.id, TZ);
  await runAs(blue.id, async () => {
    const roles = await prisma.accessRole.findMany();
    const byName = (n) => roles.find((r) => r.name === n);
    const dept = await prisma.department.findFirst();
    const make = async (name, roleName, jobTitle, extra = {}) => {
      const role = byName(roleName);
      const user = await prisma.user.create({
        data: {
          name, email: `${name.split(' ')[0].toLowerCase()}@bluewave.co.za`, employeeNo: `BW-${String(extra.no).padStart(3, '0')}`, role: SCOPE_TO_LEVEL[role.scope], accessRoleId: role.id, passwordHash, jobTitle, departmentId: dept.id,
          managerId: extra.managerId, scheduleId: (await prisma.workSchedule.findFirst()).id, startDate: toDbDate('2024-03-01'), inviteStatus: 'ACTIVATED', activatedAt: new Date(), setupCompleted: true, profile: { create: { legalName: name } },
        },
      });
      await chat.syncUserChannels(user.id);
      return user;
    };
    const admin = await make('Amahle Zungu', 'Company Admin', 'Operations Director', { no: 1 });
    const hr = await make('Zanele Mthembu', 'HR', 'HR Manager', { no: 2, managerId: admin.id });
    const mgr = await make('Peter Govender', 'Manager', 'Depot Manager', { no: 3, managerId: admin.id });
    const team = [['Sarah Naidoo', 'Dispatcher'], ['Bheki Zulu', 'Driver'], ['Kavitha Reddy', 'Logistics Coordinator'], ['Themba Ngema', 'Forklift Operator'], ['Lisa Fourie', 'Junior Planner'], ['Sanele Cele', 'Warehouse Assistant']];
    const people = [hr, mgr];
    for (const [i, [name, title]] of team.entries()) people.push(await make(name, 'Employee', title, { no: 4 + i, managerId: mgr.id }));

    // Two weeks of check-ins for everyone but the company admin, so Bluewave's screens have real history.
    const shift = await prisma.workSchedule.findFirst();
    const records = [];
    for (const u of people) {
      for (const d of eachDay(addDays(day, -14), addDays(day, -1))) {
        if (!shift.days[weekdayKey(d)] || rand() < 0.05) continue;
        const late = rand() < 0.08;
        const checkIn = zonedToUtc(d, hhmm(8 * 60 + (late ? between(11, 30) : between(-10, 8))), TZ);
        const checkOut = zonedToUtc(d, hhmm(17 * 60 + between(-5, 30)), TZ);
        const worked = hoursBetween(checkIn, checkOut);
        records.push({ userId: u.id, date: toDbDate(d), checkIn, createdAt: checkIn, checkOut, workedHours: worked, extraHours: round2(worked - 9), lateMinutes: late ? Math.round((checkIn - zonedToUtc(d, '08:00', TZ)) / 60000) : 0, source: 'BUTTON' });
      }
    }
    await prisma.attendance.createMany({ data: records });
    const types = await prisma.leaveType.findMany({ where: { requiresAllocation: true } });
    const staff = await prisma.user.findMany();
    await prisma.leaveAllocation.createMany({ data: staff.flatMap((u) => types.map((t) => ({ userId: u.id, leaveTypeId: t.id, days: 15, periodStart: toDbDate(`${year}-01-01`), periodEnd: toDbDate(`${year}-12-31`) }))) });
    for (const u of staff) {
      await prisma.contract.create({ data: { userId: u.id, reference: `${u.employeeNo}/C1`, jobTitle: u.jobTitle, startDate: u.startDate, wage: u.id === admin.id ? 68000 : u.id === mgr.id ? 48000 : 21000 + Math.round(rand() * 10) * 500, state: 'RUNNING', createdById: admin.id } });
    }
    await seedPayroll(2, hr.id, day);
    const annualBw = types.find((t) => /annual/i.test(t.name)) || types[0];
    const sarah = people.find((u) => u.name === 'Sarah Naidoo');
    const bheki = people.find((u) => u.name === 'Bheki Zulu');
    const soon = addDays(day, 12);
    await prisma.leaveRequest.create({ data: { userId: sarah.id, leaveTypeId: annualBw.id, dateFrom: toDbDate(soon), dateTo: toDbDate(addDays(soon, 1)), days: 2, state: 'SUBMITTED', reason: 'Family wedding' } });
    await prisma.leaveRequest.create({ data: { userId: bheki.id, leaveTypeId: annualBw.id, dateFrom: toDbDate(addDays(day, -40)), dateTo: toDbDate(addDays(day, -38)), days: 3, state: 'APPROVED', step1ById: mgr.id, step1At: new Date(), finalById: hr.id, finalAt: new Date() } });
    await prisma.appraisal.create({ data: { userId: sarah.id, managerId: mgr.id, deadline: toDbDate(addDays(day, 21)), state: 'PENDING', createdById: hr.id } });
    const project = await prisma.project.create({ data: { name: 'Depot Move', stageId: (await prisma.projectStage.findFirst()).id, managerId: mgr.id, createdById: mgr.id, taskStages: { create: [{ name: 'To Do', sequence: 0 }, { name: 'Done', sequence: 1, isDone: true }] } } });
    const task = await prisma.task.create({ data: { projectId: project.id, name: 'Pack the racking', createdById: mgr.id } });
    // Their time goes on the depot move; weeks before this one are validated by Peter.
    const thisWeek = toDbDate(mondayOf(day));
    await prisma.timesheetLine.createMany({
      data: records.filter((r) => r.userId !== hr.id).map((r) => {
        const done = r.date < thisWeek;
        return { userId: r.userId, date: r.date, projectId: project.id, taskId: task.id, hours: Math.round(between(6.5, 8) * 2) / 2, state: done ? 'VALIDATED' : 'DRAFT', validatedById: done ? (r.userId === mgr.id ? admin.id : mgr.id) : null };
      }),
    });
  });

  console.log(`Seeded ${all.length} users, ${attendance.length} attendance records, ${lines.length} timesheet lines.`);
  console.log(`Password for every demo account: ${PASSWORD}`);
}

main().catch((err) => { console.error(err); process.exit(1); }).finally(() => prisma.$disconnect());
