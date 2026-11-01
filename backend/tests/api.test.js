jest.mock('web-push', () => ({ sendNotification: jest.fn(async () => ({})) }));
const webpush = require('web-push');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../api/index');
const prisma = require('../lib/prisma');
const { decrypt } = require('../lib/crypto');
const { processEmailQueue } = require('../lib/email');
const { closeOverdueRecords } = require('../lib/attendance');
const { accrueMonth, balances, statement } = require('../lib/leave');
const { clearSettingsCache } = require('../lib/settings');
const { setFallbackCompany, runAs, asPlatform } = require('../lib/tenant');
const { STARTER_ROLES, SCOPE_TO_LEVEL } = require('../lib/permissions');
const { setupCompany } = require('../lib/company-setup');
const { Prisma } = require('@prisma/client');
const { userView } = require('../api/routes/auth');
const { today, addDays, mondayOf, toDbDate, zonedToUtc, fromDbDate, weekdayKey } = require('../lib/time');

const PASSWORD = 'Test@Password2026!';
const TZ = 'Africa/Johannesburg';
const day = today(TZ);
const tokens = {};
const ids = {};
let annual;
let sick;
let project;
let task;

const as = (who) => ({
  get: (url) => request(app).get(`/api${url}`).set('Authorization', `Bearer ${tokens[who]}`),
  post: (url, body) => request(app).post(`/api${url}`).set('Authorization', `Bearer ${tokens[who]}`).send(body),
  put: (url, body) => request(app).put(`/api${url}`).set('Authorization', `Bearer ${tokens[who]}`).send(body),
  patch: (url, body) => request(app).patch(`/api${url}`).set('Authorization', `Bearer ${tokens[who]}`).send(body),
  delete: (url, body) => request(app).delete(`/api${url}`).set('Authorization', `Bearer ${tokens[who]}`).send(body),
});

const login = async (email, password = PASSWORD, company = 'testco') => request(app).post('/api/auth/login').send({ email, password, company });

// A weekday well in the future, past any holiday in these tests.
function futureWeekday(offset) {
  let d = addDays(day, offset);
  while (['sat', 'sun'].includes(weekdayKey(d))) d = addDays(d, 1);
  return d;
}

function pastWeekday(offset) {
  let d = addDays(day, -offset);
  while (['sat', 'sun'].includes(weekdayKey(d))) d = addDays(d, -1);
  return d;
}

beforeAll(async () => {
  const days = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => [d, { start: '08:00', end: '17:00' }]));
  const noTwoFactor = { security: { adminTwoFactorRequired: false } };
  const platform = await prisma.company.create({ data: { name: 'Platform', slug: 'platform', isPlatform: true, settings: noTwoFactor } });
  const company = await prisma.company.create({ data: { name: 'Test Co', slug: 'testco', settings: noTwoFactor } });
  ids.company = company.id;
  setFallbackCompany(company.id);
  const accessRoles = {};
  for (const r of STARTER_ROLES) {
    const row = await prisma.accessRole.create({ data: r });
    accessRoles[r.name] = row;
    if (!accessRoles[r.scope]) accessRoles[r.scope] = row;
  }
  ids.roles = accessRoles;
  const schedule = await prisma.workSchedule.create({ data: { name: 'Standard', days, breakMinutes: 60, hoursPerDay: 8 } });
  const dept = await prisma.department.create({ data: { name: 'Operations' } });
  const hash = await bcrypt.hash(PASSWORD, 4);
  const SCOPE = { ADMIN: 'COMPANY', MANAGER: 'DEPARTMENT', EMPLOYEE: 'SELF' };
  const make = (key, role, extra = {}) => prisma.user.create({
    data: { name: `${key} Person`, email: `${key}@test.co`, employeeNo: `T-${key}`, role, accessRoleId: accessRoles[SCOPE[role]]?.id, passwordHash: hash, departmentId: dept.id, scheduleId: schedule.id, startDate: toDbDate('2020-01-01'), inviteStatus: 'ACTIVATED', profile: { create: {} }, ...extra },
  });
  const hr = await make('hr', 'ADMIN', { departmentId: null });
  const manager = await make('manager', 'MANAGER', { managerId: hr.id });
  await prisma.department.update({ where: { id: dept.id }, data: { managerId: manager.id } });
  // lead is the direct manager of emp and other; nosup reports straight to the department manager.
  const lead = await make('lead', 'MANAGER', { managerId: manager.id });
  const emp = await make('emp', 'EMPLOYEE', { managerId: lead.id });
  const other = await make('other', 'EMPLOYEE', { managerId: lead.id });
  const nosup = await make('nosup', 'EMPLOYEE', { managerId: manager.id });
  const hrstaff = await make('hrstaff', 'ADMIN', { accessRoleId: accessRoles.HR.id, departmentId: null });
  Object.assign(ids, { hr: hr.id, manager: manager.id, lead: lead.id, emp: emp.id, other: other.id, nosup: nosup.id, hrstaff: hrstaff.id, dept: dept.id, schedule: schedule.id });
  annual = await prisma.leaveType.create({ data: { name: 'Annual leave', approvalSteps: 'MANAGER_HR', accrualPerMonth: 1.25 } });
  sick = await prisma.leaveType.create({ data: { name: 'Sick leave', approvalSteps: 'MANAGER_HR', attachmentAfterDays: 2 } });
  // Two cycles, so tests that book a few weeks ahead keep working late in the year.
  const y = Number(day.slice(0, 4));
  await prisma.leaveAllocation.createMany({
    data: [emp.id, other.id, nosup.id].flatMap((userId) => [annual.id, sick.id].flatMap((leaveTypeId) => [y, y + 1].map((year) => ({ userId, leaveTypeId, days: 10, periodStart: toDbDate(`${year}-01-01`), periodEnd: toDbDate(`${year}-12-31`) })))),
  });
  project = await prisma.project.create({ data: { name: 'Warehouse', tasks: { create: [{ name: 'Stock count' }] } }, include: { tasks: true } });
  [task] = project.tasks;
  for (const key of ['hr', 'manager', 'lead', 'emp', 'other', 'nosup', 'hrstaff']) {
    tokens[key] = (await login(`${key}@test.co`)).body.token;
  }
  setFallbackCompany(platform.id);
  await prisma.user.create({ data: { name: 'Super', email: 'super@test.co', employeeNo: 'S-1', role: 'SUPER_ADMIN', passwordHash: hash, startDate: toDbDate('2020-01-01'), profile: { create: {} } } });
  setFallbackCompany(company.id);
  tokens.super = (await request(app).post('/api/auth/login').send({ email: 'super@test.co', password: PASSWORD })).body.token;
});

afterAll(async () => { await prisma.$disconnect(); });

describe('sign-in and onboarding', () => {
  let tempPassword;
  let newId;

  it('blocks non-admins from creating users', async () => {
    const res = await as('manager').post('/employees', { name: 'X', email: 'x@test.co', role: 'EMPLOYEE', startDate: day });
    expect(res.status).toBe(403);
  });


  it('creates a user, queues an encrypted welcome email and sends it', async () => {
    const res = await as('hr').post('/employees', { name: 'Zanele Khumalo', email: 'Zanele.K@Gmail.com', role: 'EMPLOYEE', startDate: day, departmentId: ids.dept, managerId: ids.manager, scheduleId: ids.schedule });
    expect(res.status).toBe(201);
    newId = res.body.employee.id;
    expect(res.body.employee.inviteStatus).toBe('SENT');
    const job = await prisma.emailJob.findFirst({ where: { userId: newId, kind: 'welcome' } });
    expect(job.htmlEnc).not.toContain('Temporary password');
    const html = decrypt(job.htmlEnc);
    expect(html).toContain('zanele.k@gmail.com');
    expect(html).toContain('/login');
    tempPassword = html.match(/font-family:Menlo,Consolas,monospace;">([^<]+)</)[1].replace(/&amp;/g, '&');
    expect(tempPassword.length).toBeGreaterThanOrEqual(12);
    const user = await prisma.user.findUnique({ where: { id: newId } });
    expect(user.passwordHash).not.toContain(tempPassword);
    await processEmailQueue();
    expect((await prisma.emailJob.findUnique({ where: { id: job.id } })).status).toBe('SENT');
  });

  it('rejects a duplicate email', async () => {
    const res = await as('hr').post('/employees', { name: 'Dup', email: 'zanele.k@gmail.com', role: 'EMPLOYEE', startDate: day });
    expect(res.status).toBe(409);
  });

  it('forces a password change before anything else', async () => {
    const res = await login('zanele.k@gmail.com', tempPassword);
    expect(res.status).toBe(200);
    tokens.zanele = res.body.token;
    const blocked = await as('zanele').post('/attendance/check-in');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    const weak = await as('zanele').post('/auth/change-password', { currentPassword: tempPassword, newPassword: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.problems.length).toBeGreaterThan(0);
    const same = await as('zanele').post('/auth/change-password', { currentPassword: tempPassword, newPassword: tempPassword });
    expect(same.status).toBe(400);
    const ok = await as('zanele').post('/auth/change-password', { currentPassword: tempPassword, newPassword: PASSWORD });
    expect(ok.status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: newId } })).inviteStatus).toBe('ACTIVATED');
    expect((await as('zanele').get('/attendance/status')).status).toBe(200);
  });

  it('resend voids the old temporary password', async () => {
    const res = await as('hr').post('/employees', { name: 'Resend Me', email: 'resend@test.co', role: 'EMPLOYEE', startDate: day });
    const id = res.body.employee.id;
    const first = decrypt((await prisma.emailJob.findFirst({ where: { userId: id } })).htmlEnc).match(/monospace;">([^<]+)</)[1].replace(/&amp;/g, '&');
    await as('hr').post(`/employees/${id}/resend-invite`, {});
    expect((await login('resend@test.co', first)).status).toBe(401);
  });

  it('rejects an expired temporary password', async () => {
    const hash = await bcrypt.hash('Temp@Password2026', 4);
    await prisma.user.create({ data: { name: 'Late', email: 'late@test.co', employeeNo: 'T-late', passwordHash: hash, startDate: toDbDate(day), mustChangePassword: true, tempPasswordExpiry: new Date(Date.now() - 1000) } });
    const res = await login('late@test.co', 'Temp@Password2026');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/resend your invite/);
  });

  it('locks the account after 5 bad passwords', async () => {
    const hash = await bcrypt.hash(PASSWORD, 4);
    await prisma.user.create({ data: { name: 'Lock', email: 'lock@test.co', employeeNo: 'T-lock', passwordHash: hash, startDate: toDbDate(day) } });
    for (let i = 0; i < 5; i += 1) expect((await login('lock@test.co', 'wrong')).status).toBe(401);
    expect((await login('lock@test.co')).status).toBe(423);
  });

  it('archived users cannot sign in and lose their session', async () => {
    const res = await as('hr').post('/employees', { name: 'Leaver', email: 'leaver@test.co', role: 'EMPLOYEE', startDate: day });
    const id = res.body.employee.id;
    await as('hr').post(`/employees/${id}/archive`, {});
    expect((await login('leaver@test.co', 'whatever')).status).toBe(401);
    expect((await prisma.user.findUnique({ where: { id } })).active).toBe(false);
  });
});

describe('attendance (Odoo behaviour)', () => {
  it('checks in, blocks a second check-in, and checks out', async () => {
    const res = await as('emp').post('/attendance/check-in');
    expect(res.status).toBe(201);
    expect(res.body.checkedIn).toBe(true);
    expect(new Date(res.body.openSince).getTime()).toBeLessThanOrEqual(Date.now());
    expect((await as('emp').post('/attendance/check-in')).status).toBe(409);
    const status = await as('emp').get('/attendance/status');
    expect(status.body.openSince).toBe(res.body.openSince);
    const out = await as('emp').post('/attendance/check-out');
    expect(out.status).toBe(200);
    expect(out.body.checkedIn).toBe(false);
    expect((await as('emp').post('/attendance/check-out')).status).toBe(409);
  });

  it('allows several pairs a day', async () => {
    await as('emp').post('/attendance/check-in');
    await as('emp').post('/attendance/check-out');
    const status = await as('emp').get('/attendance/status');
    expect(status.body.records.length).toBe(2);
  });

  it('is idempotent: a retried check-in returns the first result', async () => {
    const send = () => request(app).post('/api/attendance/check-in').set('Authorization', `Bearer ${tokens.other}`).set('Idempotency-Key', 'key-1');
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(200);
    const open = await prisma.attendance.count({ where: { userId: ids.other, openUserId: { not: null } } });
    expect(open).toBe(1);
    await as('other').post('/attendance/check-out');
  });

  it('never lets a non-admin create a past record, whatever the role', async () => {
    for (const who of ['emp', 'lead', 'manager']) {
      const res = await as(who).post('/attendance', { userId: ids.emp, date: pastWeekday(3), checkIn: '08:00', checkOut: '17:00', reason: 'x' });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/contact HR/);
    }
  });

  it('HR can add a missed day, with a mandatory reason, and it is audited', async () => {
    const date = pastWeekday(3);
    expect((await as('hr').post('/attendance', { userId: ids.emp, date, checkIn: '08:00', checkOut: '17:00' })).status).toBe(400);
    const res = await as('hr').post('/attendance', { userId: ids.emp, date, checkIn: '08:00', checkOut: '17:00', reason: 'Biometric outage' });
    expect(res.status).toBe(201);
    const rec = await prisma.attendance.findUnique({ where: { id: res.body.id } });
    expect(rec.source).toBe('ADMIN');
    expect(rec.workedHours).toBe(9);
    expect(rec.extraHours).toBe(0);
    const log = await prisma.auditLog.findFirst({ where: { action: 'attendance.admin_created', entityId: String(rec.id) } });
    expect(log.actorId).toBe(ids.hr);
  });

  describe('editing', () => {
    let id;
    const date = pastWeekday(4);
    beforeAll(async () => {
      id = (await as('hr').post('/attendance', { userId: ids.emp, date, checkIn: '08:00', checkOut: '16:00', reason: 'setup' })).body.id;
    });

    it('lets the owner edit times, flags it and records old and new', async () => {
      const res = await as('emp').patch(`/attendance/${id}`, { checkOut: '17:00', reason: 'Forgot' });
      expect(res.status).toBe(200);
      const rec = await prisma.attendance.findUnique({ where: { id }, include: { edits: true } });
      expect(rec.isEdited).toBe(true);
      expect(rec.workedHours).toBe(9);
      const edit = rec.edits.find((e) => e.field === 'check-out');
      expect([edit.oldValue, edit.newValue]).toEqual(['16:00', '17:00']);
    });

    it('requires a reason', async () => {
      expect((await as('emp').patch(`/attendance/${id}`, { checkOut: '16:30' })).status).toBe(400);
    });

    it('rejects check-out before check-in', async () => {
      const res = await as('emp').patch(`/attendance/${id}`, { checkIn: '18:00', checkOut: '17:00', reason: 'x' });
      expect(res.status).toBe(422);
    });

    it('rejects an overlap with another record', async () => {
      await as('hr').post('/attendance', { userId: ids.emp, date, checkIn: '18:00', checkOut: '19:00', reason: 'second pair' });
      const res = await as('emp').patch(`/attendance/${id}`, { checkOut: '18:30', reason: 'x' });
      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/overlap/);
    });

    it('stops a colleague but allows their manager, and notifies the employee', async () => {
      expect((await as('other').patch(`/attendance/${id}`, { checkOut: '17:10', reason: 'x' })).status).toBe(403);
      const res = await as('lead').patch(`/attendance/${id}`, { checkOut: '17:15', reason: 'Fix' });
      expect(res.status).toBe(200);
      const note = await prisma.notification.findFirst({ where: { userId: ids.emp, type: 'attendance.edited' } });
      expect(note).not.toBeNull();
    });

    it('blocks non-admins before the lock date and lets HR through', async () => {
      await as('hr').put('/settings/company', { attendance: { lockDate: day } });
      clearSettingsCache();
      const blocked = await as('emp').patch(`/attendance/${id}`, { checkOut: '17:20', reason: 'x' });
      expect(blocked.status).toBe(403);
      expect(blocked.body.error).toMatch(/Period locked/);
      expect((await as('hr').patch(`/attendance/${id}`, { checkOut: '17:20', reason: 'correction' })).status).toBe(200);
      await as('hr').put('/settings/company', { attendance: { lockDate: '2000-01-01' } });
      clearSettingsCache();
    });
  });

  it('marks an empty past workday as Absent without creating anything', async () => {
    const res = await as('nosup').get(`/attendance?from=${pastWeekday(2)}&to=${pastWeekday(2)}`);
    expect(res.body.items[0].status.key).toBe('absent');
    expect(res.body.canCreate).toBe(false);
  });

  it('auto-closes a forgotten check-out at schedule end + 4 hours', async () => {
    const date = pastWeekday(6);
    await prisma.attendance.create({ data: { userId: ids.nosup, date: toDbDate(date), checkIn: zonedToUtc(date, '08:00', TZ), openUserId: ids.nosup } });
    await closeOverdueRecords();
    const rec = await prisma.attendance.findFirst({ where: { userId: ids.nosup, date: toDbDate(date) } });
    expect(rec.autoClosed).toBe(true);
    expect(rec.source).toBe('AUTO');
    expect(rec.openUserId).toBeNull();
    expect(rec.checkOut.getTime()).toBe(zonedToUtc(date, '21:00', TZ).getTime());
    expect(rec.workedHours).toBe(13);
  });

  it('flags lateness past the grace period', async () => {
    const date = pastWeekday(5);
    const res = await as('hr').post('/attendance', { userId: ids.other, date, checkIn: '08:30', checkOut: '17:00', reason: 'test' });
    const rec = await prisma.attendance.findUnique({ where: { id: res.body.id } });
    expect(rec.lateMinutes).toBe(30);
  });

  it('counts a lunch gap as the break when working out extra hours', async () => {
    const date = pastWeekday(9);
    await as('hr').post('/attendance', { userId: ids.other, date, checkIn: '08:00', checkOut: '12:00', reason: 'am' });
    await as('hr').post('/attendance', { userId: ids.other, date, checkIn: '13:00', checkOut: '17:00', reason: 'pm' });
    const rows = await prisma.attendance.findMany({ where: { userId: ids.other, date: toDbDate(date) }, orderBy: { checkIn: 'asc' } });
    expect(rows[1].extraHours).toBe(0);
  });
});

describe('timesheets', () => {
  const week = mondayOf(addDays(day, -14));
  const cell = (hours, date = week) => ({ date, projectId: project.id, taskId: task.id, hours });

  it('accepts decimal and HH:MM and shows up in the grid with totals', async () => {
    await as('emp').post('/timesheets/rows', { week, projectId: project.id, taskId: task.id });
    expect((await as('emp').put('/timesheets/cell', cell('3:30'))).status).toBe(200);
    await as('emp').put('/timesheets/cell', cell(4, addDays(week, 1)));
    const grid = await as('emp').get(`/timesheets/grid?week=${week}`);
    expect(grid.body.rows[0].cells[week].hours).toBe(3.5);
    expect(grid.body.rows[0].total).toBe(7.5);
    expect(grid.body.days[0].logged).toBe(3.5);
  });

  it('rejects a day over 24 hours', async () => {
    expect((await as('emp').put('/timesheets/cell', cell(25))).status).toBe(422);
  });

  it('runs one timer at a time and rounds up to 15 minutes', async () => {
    await as('emp').post('/timesheets/timer/start', { projectId: project.id, taskId: task.id });
    expect((await as('emp').get('/timesheets/grid')).body.timer.task).toBe('Stock count');
    const started = await as('emp').post('/timesheets/timer/start', { projectId: project.id, taskId: task.id });
    expect(started.body.stopped.hours).toBe(0.25);
    expect(await prisma.timerSession.count({ where: { userId: ids.emp } })).toBe(1);
    const stop = await as('emp').post('/timesheets/timer/stop');
    expect(stop.body.stopped.hours).toBe(0.25);
    const line = await prisma.timesheetLine.findFirst({ where: { userId: ids.emp, date: toDbDate(day) } });
    expect(line.hours).toBe(0.5);
    expect((await as('emp').post('/timesheets/timer/stop')).status).toBe(409);
  });

  it('employees cannot log for someone else, HR can', async () => {
    expect((await as('other').put('/timesheets/cell', { ...cell(1), userId: ids.emp })).status).toBe(403);
    expect((await as('hr').put('/timesheets/cell', { ...cell(1, addDays(week, 2)), userId: ids.emp })).status).toBe(200);
  });

  it('their manager validates, which locks the week, and only a manager resets it', async () => {
    expect((await as('emp').post('/timesheets/validate', { userId: ids.emp, week })).status).toBe(403);
    expect((await as('manager').post('/timesheets/validate', { userId: ids.emp, week })).status).toBe(409);
    const done = await as('lead').post('/timesheets/validate', { userId: ids.emp, week });
    expect(done.body.state).toBe('VALIDATED');
    expect((await as('emp').put('/timesheets/cell', cell(2, addDays(week, 3)))).status).toBe(423);
    expect((await as('other').post('/timesheets/reset', { userId: ids.emp, week })).status).toBe(403);
    expect((await as('lead').post('/timesheets/reset', { userId: ids.emp, week })).status).toBe(200);
    expect((await as('emp').put('/timesheets/cell', cell(2))).status).toBe(200);
  });

  it('blocks validating your own timesheet', async () => {
    await as('manager').put('/timesheets/cell', cell(1));
    expect((await as('manager').post('/timesheets/validate', { userId: ids.manager, week })).status).toBe(403);
  });

  it('lists the team week in the approver inbox', async () => {
    const res = await as('lead').get('/approvals');
    expect(res.body.timesheets.some((t) => t.userId === ids.emp)).toBe(true);
    expect(res.body.timesheets.some((t) => t.userId === ids.manager)).toBe(false);
  });
});

describe('leave', () => {
  const from = futureWeekday(40);
  const body = (over = {}) => ({ leaveTypeId: annual.id, dateFrom: from, dateTo: from, reason: 'Trip', ...over });
  let requestId;

  it('previews working days and balance after', async () => {
    const monday = mondayOf(futureWeekday(50));
    const res = await as('emp').post('/leave/preview', body({ dateFrom: monday, dateTo: addDays(monday, 6) }));
    expect(res.body.days).toBe(5);
    expect(res.body.balanceAfter).toBe(res.body.bookable - 5);
  });

  it('excludes a public holiday', async () => {
    const monday = mondayOf(futureWeekday(60));
    await as('hr').post('/settings/holidays', { date: addDays(monday, 1), name: 'Test Day' });
    const res = await as('emp').post('/leave/preview', body({ dateFrom: monday, dateTo: addDays(monday, 2) }));
    expect(res.body.days).toBe(2);
  });

  it('blocks more than the balance', async () => {
    const res = await as('emp').post('/leave/requests', body({ dateTo: addDays(from, 40) }));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/available/);
  });

  it('runs Submitted → Manager → HR → Approved', async () => {
    const res = await as('emp').post('/leave/requests', body());
    expect(res.status).toBe(201);
    requestId = res.body.request.id;
    expect(res.body.request.state).toBe('SUBMITTED');
    expect((await prisma.notification.findFirst({ where: { userId: ids.lead, type: 'approvals.leave' } }))).not.toBeNull();
    expect((await as('manager').post(`/leave/requests/${requestId}/approve`, {})).status).toBe(403);
    const step1 = await as('lead').post(`/leave/requests/${requestId}/approve`, {});
    expect(step1.body.request.state).toBe('PARTLY_APPROVED');
    expect((await as('lead').post(`/leave/requests/${requestId}/approve`, {})).status).toBe(403);
    expect((await as('hr').get('/leave/inbox')).body.requests.some((r) => r.id === requestId)).toBe(true);
    const mine = (await as('emp').get('/leave/requests')).body.requests.find((r) => r.id === requestId);
    expect(mine.steps).toEqual(['Manager', 'HR']);
    const final = await as('hr').post(`/leave/requests/${requestId}/approve`, {});
    expect(final.body.request.state).toBe('APPROVED');
    const bal = (await balances(ids.emp, Number(from.slice(0, 4)))).find((b) => b.leaveTypeId === annual.id);
    expect(bal.taken).toBe(1);
    const bot = await prisma.message.findFirst({ where: { senderId: null, conversation: { directKey: `bot:${ids.emp}` } }, orderBy: { id: 'desc' } });
    expect(bot.body).toMatch(/approved/);
  });

  it('blocks overlapping requests', async () => {
    const res = await as('emp').post('/leave/requests', body());
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/already have leave/);
  });

  it('greys approved leave in timesheets', async () => {
    const grid = await as('emp').get(`/timesheets/grid?week=${mondayOf(from)}`);
    expect(grid.body.days.find((d) => d.date === from).leave).toBe('Annual leave');
  });

  it('cancelling restores the balance', async () => {
    const year = Number(from.slice(0, 4));
    const before = (await balances(ids.emp, year)).find((b) => b.leaveTypeId === annual.id).available;
    await as('emp').post(`/leave/requests/${requestId}/cancel`);
    const after = (await balances(ids.emp, year)).find((b) => b.leaveTypeId === annual.id).available;
    expect(after).toBe(before + 1);
  });

  it('refusal needs a reason, which the employee sees', async () => {
    const res = await as('other').post('/leave/requests', body());
    const id = res.body.request.id;
    expect((await as('lead').post(`/leave/requests/${id}/refuse`, {})).status).toBe(400);
    await as('lead').post(`/leave/requests/${id}/refuse`, { reason: 'Stock take' });
    const mine = await as('other').get('/leave/requests');
    expect(mine.body.requests[0].refuseReason).toBe('Stock take');
  });

  it('goes to their manager, then HR (BR-07)', async () => {
    const res = await as('nosup').post('/leave/requests', body());
    const id = res.body.request.id;
    const inbox = await as('manager').get('/leave/inbox');
    expect(inbox.body.requests.some((r) => r.id === id)).toBe(true);
    const step = await as('manager').post(`/leave/requests/${id}/approve`, {});
    expect(step.body.request.state).toBe('PARTLY_APPROVED');
    const approved = await as('hr').post(`/leave/requests/${id}/approve`, {});
    expect(approved.body.request.state).toBe('APPROVED');
  });

  it('a leave type can skip the manager and go straight to HR', async () => {
    const direct = await prisma.leaveType.create({ data: { name: 'Straight to HR', requiresAllocation: false, approvalSteps: 'HR' } });
    const date = futureWeekday(90);
    const res = await as('emp').post('/leave/requests', { leaveTypeId: direct.id, dateFrom: date, dateTo: date });
    const id = res.body.request.id;
    expect((await as('lead').get('/leave/inbox')).body.requests.some((r) => r.id === id)).toBe(false);
    expect((await as('lead').post(`/leave/requests/${id}/approve`, {})).status).toBe(403);
    expect((await as('hr').get('/leave/inbox')).body.requests.some((r) => r.id === id)).toBe(true);
    expect((await as('hr').post(`/leave/requests/${id}/approve`, {})).body.request.state).toBe('APPROVED');
    await as('emp').post(`/leave/requests/${id}/cancel`);
    await prisma.leaveType.update({ where: { id: direct.id }, data: { active: false } });
  });

  it('nobody approves their own leave (BR-08)', async () => {
    const y = from.slice(0, 4);
    await prisma.leaveAllocation.create({ data: { userId: ids.hr, leaveTypeId: annual.id, days: 5, periodStart: toDbDate(`${y}-01-01`), periodEnd: toDbDate(`${y}-12-31`) } });
    const res = await as('hr').post('/leave/requests', body());
    expect((await as('hr').post(`/leave/requests/${res.body.request.id}/approve`, {})).status).toBe(403);
  });

  it('requires a document past the type limit', async () => {
    const start = mondayOf(futureWeekday(70));
    const res = await as('emp').post('/leave/requests', { leaveTypeId: sick.id, dateFrom: start, dateTo: addDays(start, 2) });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/document/);
  });

  it('shows conflicts to the approver', async () => {
    const date = futureWeekday(80);
    await as('emp').post('/leave/requests', body({ dateFrom: date, dateTo: date }));
    await as('other').post('/leave/requests', body({ dateFrom: date, dateTo: date }));
    const inbox = await as('lead').get('/leave/inbox');
    const row = inbox.body.requests.find((r) => r.dateFrom === date);
    expect(row.conflicts.length).toBe(1);
  });

  it('accrues once a month and the statement matches the balance card', async () => {
    const first = `${day.slice(0, 7)}-01`;
    await accrueMonth(first);
    await accrueMonth(first);
    const count = await prisma.leaveAllocation.count({ where: { userId: ids.emp, kind: 'ACCRUAL', periodStart: toDbDate(first) } });
    expect(count).toBe(1);
    const year = Number(day.slice(0, 4));
    const s = await statement(ids.emp, annual.id, year);
    const bal = (await balances(ids.emp, year)).find((b) => b.leaveTypeId === annual.id);
    expect(s.availableToday).toBe(bal.available);
  });
});

describe('profile self-service', () => {
  it('saves instant fields at once and tells HR old and new', async () => {
    await as('emp').patch('/profile/me', { phone: '+27 82 555 0000' });
    const res = await as('emp').patch('/profile/me', { phone: '+27 82 555 0143' });
    expect(res.body.profile.phone).toBe('+27 82 555 0143');
    const note = await prisma.notification.findFirst({ where: { userId: ids.hr, type: 'profile.updated' }, orderBy: { id: 'desc' } });
    expect(note.title).toMatch(/updated mobile number/);
    expect(note.body).toContain('+27 82 555 0000 → +27 82 555 0143');
  });

  it('holds sensitive fields until HR approves', async () => {
    const res = await as('emp').patch('/profile/me', { bankAccount: '6281009021', bankName: 'FNB' });
    expect(res.body.pendingRequest).toBeTruthy();
    expect(res.body.profile.bankName).toBe('');
    const row = await prisma.changeRequest.findUnique({ where: { id: res.body.pendingRequest } });
    expect(row.payloadEnc).not.toContain('6281009021');
    expect(JSON.stringify(row.summary)).not.toContain('6281009021');
    expect((await as('emp').post(`/profile/requests/${row.id}/approve`, {})).status).toBe(403);
    await as('hr').post(`/profile/requests/${row.id}/approve`, {});
    const after = await as('emp').get('/profile/me');
    expect(after.body.profile.bankName).toBe('FNB');
    expect(after.body.profile.bankAccount.endsWith('9021')).toBe(true);
    expect(after.body.profile.bankAccount).not.toContain('6281');
  });

  it('ignores attempts to change job fields', async () => {
    await as('emp').patch('/profile/me', { role: 'ADMIN', jobTitle: 'CEO', salaryBand: 'Z9' });
    const user = await prisma.user.findUnique({ where: { id: ids.emp } });
    expect(user.role).toBe('EMPLOYEE');
    expect(user.jobTitle).toBeNull();
  });

  it('hides bank details from a manager', async () => {
    const res = await as('manager').get(`/profile/${ids.emp}`);
    expect(res.body.profile.bankAccount).toBeUndefined();
    expect((await as('other').get(`/profile/${ids.emp}`)).status).toBe(403);
  });
});

describe('celebrations', () => {
  it('never exposes a birth year and respects hide-my-birthday', async () => {
    await prisma.profile.update({ where: { userId: ids.emp }, data: { birthDate: toDbDate(`1990-${day.slice(5)}`) } });
    let res = await as('other').get('/people/celebrations');
    expect(res.body.today.some((p) => p.id === ids.emp)).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('1990');
    await as('emp').put('/settings/preferences', { showBirthday: false });
    res = await as('other').get('/people/celebrations');
    expect(res.body.today.some((p) => p.id === ids.emp)).toBe(false);
    await as('emp').put('/settings/preferences', { showBirthday: true });
  });

  it('allows one wish per person per year', async () => {
    expect((await as('other').post(`/people/${ids.emp}/wish`, { message: 'Enjoy' })).status).toBe(201);
    expect((await as('other').post(`/people/${ids.emp}/wish`, {})).status).toBe(409);
  });
});

describe('chat', () => {
  let conversationId;

  it('keeps a direct thread between two people', async () => {
    const a = await as('emp').post('/chat/direct', { userId: ids.other });
    const b = await as('other').post('/chat/direct', { userId: ids.emp });
    expect(a.body.conversationId).toBe(b.body.conversationId);
    conversationId = a.body.conversationId;
  });

  it('delivers, counts unread and clears it', async () => {
    const res = await as('emp').post(`/chat/conversations/${conversationId}/messages`, { body: 'Hello', clientId: 'c1' });
    expect(res.status).toBe(201);
    const again = await as('emp').post(`/chat/conversations/${conversationId}/messages`, { body: 'Hello', clientId: 'c1' });
    expect(again.body.message.id).toBe(res.body.message.id);
    expect((await as('other').get('/chat/unread')).body.unread).toBeGreaterThan(0);
    await as('other').post(`/chat/conversations/${conversationId}/read`);
    const list = await as('other').get('/chat/conversations');
    expect(list.body.direct.find((c) => c.id === conversationId).unread).toBe(0);
  });

  it('keeps outsiders out', async () => {
    expect((await as('nosup').get(`/chat/conversations/${conversationId}/messages`)).status).toBe(403);
  });

  it('makes #announcements read-only for staff', async () => {
    await as('emp').get('/chat/conversations');
    await as('manager').get('/chat/conversations');
    const channel = await prisma.conversation.findFirst({ where: { channelKind: 'ANNOUNCEMENTS' } });
    const staff = await as('emp').post(`/chat/conversations/${channel.id}/messages`, { body: 'Hi' });
    expect(staff.status).toBe(403);
    expect((await as('manager').post(`/chat/conversations/${channel.id}/messages`, { body: 'Notice' })).status).toBe(201);
  });

  it('shows Message deleted and enforces the 15-minute window', async () => {
    const m = await as('emp').post(`/chat/conversations/${conversationId}/messages`, { body: 'Oops' });
    const del = await as('emp').delete(`/chat/messages/${m.body.message.id}`);
    expect(del.body.message.deleted).toBe(true);
    expect(del.body.message.body).toBeNull();
    const old = await as('emp').post(`/chat/conversations/${conversationId}/messages`, { body: 'Old' });
    await prisma.message.update({ where: { id: old.body.message.id }, data: { createdAt: new Date(Date.now() - 16 * 60000) } });
    expect((await as('emp').patch(`/chat/messages/${old.body.message.id}`, { body: 'New' })).status).toBe(409);
  });

  it('export needs a reason and permission, and is audited', async () => {
    expect((await as('emp').post(`/chat/conversations/${conversationId}/export`, { reason: 'x' })).status).toBe(403);
    expect((await as('hr').post(`/chat/conversations/${conversationId}/export`, {})).status).toBe(400);
    const res = await as('hr').post(`/chat/conversations/${conversationId}/export`, { reason: 'Grievance 12' });
    expect(res.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'chat.exported' } })).toBe(1);
  });

  it('removes archived users from channels', async () => {
    const res = await as('hr').post('/employees', { name: 'Gone', email: 'gone@test.co', role: 'EMPLOYEE', startDate: day, departmentId: ids.dept });
    const id = res.body.employee.id;
    expect(await prisma.conversationMember.count({ where: { userId: id } })).toBeGreaterThan(0);
    await as('hr').post(`/employees/${id}/archive`, {});
    expect(await prisma.conversationMember.count({ where: { userId: id, conversation: { type: 'CHANNEL' } } })).toBe(0);
  });
});

describe('calendar', () => {
  it('shows a private event as Busy with no details', () => {
    const { normaliseGoogle } = require('../lib/calendar');
    const e = normaliseGoogle({ id: '1', visibility: 'private', summary: 'Doctor', location: 'Clinic', hangoutLink: 'https://meet.google.com/x', start: { dateTime: '2026-11-02T08:00:00Z' }, end: { dateTime: '2026-11-02T09:00:00Z' } });
    expect(e.title).toBe('Busy');
    expect(e.location).toBeNull();
    expect(e.meetingUrl).toBeNull();
  });

  it('gives team members busy blocks without titles', async () => {
    const provider = 'GOOGLE';
    const conn = await prisma.calendarConnection.create({ data: { userId: ids.emp, provider, refreshEnc: 'x' } });
    await prisma.syncedEvent.create({ data: { connectionId: conn.id, userId: ids.emp, externalId: 'e1', title: 'Secret project', startAt: new Date(), endAt: new Date(Date.now() + 3600000) } });
    const res = await as('lead').get(`/calendar/team-busy?from=${day}&to=${day}`);
    expect(JSON.stringify(res.body)).not.toContain('Secret project');
    expect(res.body.people.find((p) => p.id === ids.emp).busy.length).toBe(1);
    expect((await as('emp').get(`/calendar/team-busy?from=${day}&to=${day}`)).status).toBe(403);
    await prisma.syncedEvent.deleteMany({});
    await prisma.calendarConnection.deleteMany({});
  });

  it('says a provider is not configured rather than failing', async () => {
    const res = await as('emp').get('/calendar/connect/google');
    expect(res.status).toBe(503);
  });
});

describe('access control', () => {
  it('requires a token', async () => {
    expect((await request(app).get('/api/attendance/status')).status).toBe(401);
  });

  it('keeps role screens to their roles on the API', async () => {
    expect((await as('emp').get('/employees')).status).toBe(403);
    expect((await as('emp').get('/dashboard/team')).status).toBe(403);
    expect((await as('lead').get('/dashboard/hr')).status).toBe(403);
    expect((await as('hr').get('/system/health')).status).toBe(403);
    expect((await as('emp').get('/settings/audit')).status).toBe(403);
    expect((await as('super').get('/system/health')).status).toBe(200);
  });

  it('scopes attendance lists to the team', async () => {
    expect((await as('other').get(`/attendance?scope=team&userId=${ids.emp}`)).status).toBe(403);
    const sup = await as('lead').get('/attendance?scope=team');
    expect(sup.body.items.every((i) => [ids.lead, ids.emp, ids.other].includes(i.userId))).toBe(true);
  });

  it('a company admin changes a role and it takes effect', async () => {
    const { clearPermissionCache } = require('../lib/permissions');
    const role = ids.roles.DEPARTMENT;
    const without = role.permissions.filter((k) => k !== 'reports.view');
    await as('hr').patch(`/roles/${role.id}`, { permissions: without });
    expect((await as('lead').get('/reports/attendance')).status).toBe(403);
    await as('hr').patch(`/roles/${role.id}`, { permissions: role.permissions });
    clearPermissionCache();
    expect((await as('lead').get('/reports/attendance')).status).toBe(200);
    expect((await as('emp').patch(`/roles/${role.id}`, { permissions: [] })).status).toBe(403);
  });

  it('maintenance mode shuts staff out but not the Super Admin', async () => {
    await as('super').put('/system/settings', { system: { maintenance: true } });
    expect((await as('emp').get('/attendance/status')).status).toBe(503);
    expect((await as('super').get('/system/health')).status).toBe(200);
    await as('super').put('/system/settings', { system: { maintenance: false } });
    clearSettingsCache();
  });

  it('view-as is read-only, audited, and tells the person', async () => {
    clearSettingsCache();
    const res = await as('super').post(`/system/impersonate/${ids.emp}`, { reason: 'Support ticket' });
    expect(res.status).toBe(200);
    tokens.view = res.body.token;
    expect((await as('view').get('/attendance/status')).status).toBe(200);
    expect((await as('view').post('/attendance/check-in')).status).toBe(403);
    expect(await prisma.notification.count({ where: { userId: ids.emp, type: 'system.view_as' } })).toBe(1);
    expect((await as('view').post('/system/impersonate/stop')).status).toBe(200);
    expect((await as('view').get('/attendance/status')).status).toBe(401);
  });

  it('admins are held at the 2FA gate when the policy is on', async () => {
    await as('hr').put('/settings/security', { security: { adminTwoFactorRequired: true } });
    clearSettingsCache();
    const res = await as('hr').get('/employees');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TWO_FACTOR_REQUIRED');
    expect((await as('emp').get('/attendance/status')).status).toBe(200);
    await prisma.company.update({ where: { id: ids.company }, data: { settings: { security: { adminTwoFactorRequired: false } } } });
    clearSettingsCache();
  });
});

describe('reports', () => {
  it('exports CSV and Excel, with spreadsheet formulas neutralised', async () => {
    await prisma.user.update({ where: { id: ids.emp }, data: { name: '=cmd() Person' } });
    const csv = await as('hr').get('/reports/attendance?format=csv');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain("'=cmd()");
    const xlsx = await as('hr').get('/reports/leave?format=xlsx');
    expect(xlsx.status).toBe(200);
    await prisma.user.update({ where: { id: ids.emp }, data: { name: 'emp Person' } });
  });

  it('team reports only contain the team', async () => {
    const res = await as('lead').get('/reports/attendance');
    expect(res.body.rows.every((r) => !r.name.startsWith('hr '))).toBe(true);
  });
});

describe('onboarding link and office holidays', () => {
  it('welcome email links to an invite that identifies the person, once', async () => {
    const res = await as('hr').post('/employees', { name: 'Link Person', email: 'link@test.co', role: 'EMPLOYEE', startDate: day });
    const html = decrypt((await prisma.emailJob.findFirst({ where: { userId: res.body.employee.id, kind: 'welcome' } })).htmlEnc);
    const token = html.match(/login\?invite=([\w.-]+)/)[1];
    const info = await request(app).get(`/api/auth/invite/${token}`);
    expect(info.body).toMatchObject({ valid: true, email: 'link@test.co', firstName: 'Link' });
    expect((await prisma.user.findUnique({ where: { id: res.body.employee.id } })).inviteStatus).toBe('OPENED');
    expect((await request(app).get('/api/auth/invite/rubbish')).body.valid).toBe(false);
    await prisma.user.update({ where: { id: res.body.employee.id }, data: { mustChangePassword: false } });
    expect((await request(app).get(`/api/auth/invite/${token}`)).body.used).toBe(true);
  });

  it('HR sets an office closure that leave does not count; staff cannot', async () => {
    const monday = mondayOf(futureWeekday(30));
    expect((await as('emp').post('/settings/holidays', { date: monday, name: 'Closed' })).status).toBe(403);
    const res = await as('hr').post('/settings/holidays', { date: addDays(monday, 2), name: 'Staff day', kind: 'OFFICE' });
    expect(res.body.holiday.kind).toBe('OFFICE');
    const preview = await as('emp').post('/leave/preview', { leaveTypeId: annual.id, dateFrom: monday, dateTo: addDays(monday, 4) });
    expect(preview.body.days).toBe(4);
  });
});

describe('timesheet entries (Odoo line form)', () => {
  const week = mondayOf(addDays(day, -21));
  const entry = (over = {}) => ({ date: week, projectId: project.id, taskId: task.id, hours: '1:30', description: 'Counted bay 3', ...over });

  it('holds several lines in one grid cell, summed', async () => {
    await as('nosup').post('/timesheets/entries', entry());
    await as('nosup').post('/timesheets/entries', entry({ hours: 2 }));
    const grid = await as('nosup').get(`/timesheets/grid?week=${week}`);
    expect(grid.body.rows[0].cells[week].hours).toBe(3.5);
    expect((await as('nosup').get('/timesheets/lines')).body.lines.length).toBeGreaterThanOrEqual(2);
  });

  it('typing a new total in the grid adjusts the latest line only', async () => {
    await as('nosup').put('/timesheets/cell', { date: week, projectId: project.id, taskId: task.id, hours: 4 });
    const lines = await prisma.timesheetLine.findMany({ where: { userId: ids.nosup, date: toDbDate(week) }, orderBy: { id: 'asc' } });
    expect(lines.map((l) => l.hours)).toEqual([1.5, 2.5]);
    expect((await as('nosup').put('/timesheets/cell', { date: week, projectId: project.id, taskId: task.id, hours: 1 })).status).toBe(422);
  });

  it('tags the person assisted, who gets an in-app notification and no email', async () => {
    const emails = await prisma.emailJob.count({ where: { userId: ids.other } });
    await as('nosup').post('/timesheets/entries', entry({ assistedUserId: ids.other, date: addDays(week, 1) }));
    const note = await prisma.notification.findFirst({ where: { userId: ids.other, type: 'tagged.timesheet' } });
    expect(note.title).toMatch(/tagged you as assisting on Warehouse/);
    expect(await prisma.emailJob.count({ where: { userId: ids.other } })).toBe(emails);
  });

  it('a task is optional, and any employee can create a project', async () => {
    const created = await as('nosup').post('/projects', { name: 'My side project' });
    expect(created.status).toBe(201);
    const res = await as('nosup').post('/timesheets/entries', { date: addDays(week, 2), projectId: created.body.project.id, hours: 1 });
    expect(res.status).toBe(201);
    expect(res.body.line.taskId).toBeNull();
    const grid = await as('nosup').get(`/timesheets/grid?week=${week}`);
    expect(grid.body.rows.find((r) => r.project === 'My side project').task).toBeNull();
  });

  it('a timer with a description becomes its own entry and tags the helper', async () => {
    await as('other').post('/timesheets/timer/start', { projectId: project.id, assistedUserId: ids.nosup, description: 'Pairing' });
    const res = await as('other').post('/timesheets/timer/stop');
    expect(res.body.stopped.hours).toBe(0.25);
    expect(await prisma.timesheetLine.count({ where: { userId: ids.other, description: 'Pairing', assistedUserId: ids.nosup } })).toBe(1);
  });

  it('protects other people and locked weeks', async () => {
    const line = await prisma.timesheetLine.findFirst({ where: { userId: ids.nosup, date: toDbDate(week) } });
    expect((await as('other').patch(`/timesheets/entries/${line.id}`, { hours: 9 })).status).toBe(403);
    await as('manager').post('/timesheets/validate', { userId: ids.nosup, week });
    expect((await as('nosup').delete(`/timesheets/entries/${line.id}`)).status).toBe(423);
    const recent = await as('manager').get('/approvals/recent');
    expect(recent.body.timesheets.some((t) => t.userId === ids.nosup && t.week === week)).toBe(true);
    expect((await as('lead').get('/approvals/recent')).body.timesheets).toEqual([]);
  });
});

describe('teams and person profile', () => {
  it('shows the team, reporting line and who someone works with', async () => {
    const team = await as('hr').post('/settings/teams', { name: 'Software Development', departmentId: ids.dept, leadId: ids.lead });
    expect((await as('emp').post('/settings/teams', { name: 'Nope' })).status).toBe(403);
    await as('hr').patch(`/employees/${ids.emp}`, { teamId: team.body.team.id, jobTitle: 'Software Developer' });
    await as('hr').patch(`/employees/${ids.other}`, { teamId: team.body.team.id });
    const res = await as('nosup').get(`/people/${ids.emp}`);
    const p = res.body.person;
    expect(p.jobTitle).toBe('Software Developer');
    expect(p.team.name).toBe('Software Development');
    expect(p.team.lead.id).toBe(ids.lead);
    expect(p.manager.id).toBe(ids.lead);
    expect(p.worksWith.map((w) => w.id)).toEqual([ids.other]);
    expect(JSON.stringify(p)).not.toContain('bankAccount');
  });

  it('employees can upload a photo and it shows on their profile', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const up = await request(app).post('/api/files').set('Authorization', `Bearer ${tokens.other}`).field('purpose', 'photo').attach('file', png, { filename: 'me.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    await as('other').patch('/profile/me', { photoFileId: up.body.file.id });
    expect((await as('emp').get(`/people/${ids.other}`)).body.person.photoFileId).toBe(up.body.file.id);
    expect((await as('emp').get(`/files/${up.body.file.id}`)).status).toBe(200);
  });
});

describe('projects module', () => {
  let p;
  let t;

  it('creates with task stages, on the first project stage, managed by the creator', async () => {
    const stage = await as('manager').post('/projects/stages', { name: 'Implementation' });
    expect((await as('emp').post('/projects/stages', { name: 'No' })).status).toBe(403);
    const res = await as('manager').post('/projects', { name: 'ERP rollout', customer: 'Acme' });
    p = res.body.project;
    expect(p.stageId).toBe(stage.body.stage.id);
    const detail = await as('manager').get(`/projects/${p.id}`);
    expect(detail.body.taskStages.map((s) => s.name)).toEqual(['To Do', 'In Progress', 'Review', 'Done']);
    expect(detail.body.project.manager.id).toBe(ids.manager);
    expect(detail.body.canEdit).toBe(true);
  });

  it('only the project manager edits it, and stage moves are tracked', async () => {
    expect((await as('emp').patch(`/projects/${p.id}`, { name: 'Hacked' })).status).toBe(403);
    const second = await as('manager').post('/projects/stages', { name: 'Support' });
    await as('manager').patch(`/projects/${p.id}`, { stageId: second.body.stage.id, allocatedHours: 2 });
    const chatter = await as('emp').get(`/projects/chatter/project/${p.id}`);
    expect(chatter.body.entries.some((e) => e.body.includes('Implementation → Support'))).toBe(true);
  });

  it('assigning a task notifies in-app, and time logged reduces the budget', async () => {
    const res = await as('manager').post(`/projects/${p.id}/tasks`, { name: 'Migrate data', assigneeIds: [ids.emp], deadline: addDays(day, -1) });
    t = res.body.task;
    expect(await prisma.notification.count({ where: { userId: ids.emp, type: 'tagged.task' } })).toBe(1);
    await as('emp').post('/timesheets/entries', { date: addDays(mondayOf(day), -28), projectId: p.id, taskId: t.id, hours: 3 });
    const card = (await as('emp').get('/projects')).body.projects.find((x) => x.id === p.id);
    expect(card.tasksTotal).toBe(1);
    expect(card.remainingHours).toBe(-1);
    const mine = await as('emp').get('/projects/tasks?mine=true&open=true');
    expect(mine.body.tasks.map((x) => x.id)).toContain(t.id);
    const dash = await as('emp').get('/projects/dashboard');
    expect(dash.body.overdue).toBeGreaterThanOrEqual(1);
    expect(dash.body.overBudget.some((x) => x.id === p.id)).toBe(true);
  });

  it('moving to a Done stage counts on the Tasks button', async () => {
    const detail = await as('manager').get(`/projects/${p.id}`);
    const done = detail.body.taskStages.find((s) => s.isDone);
    await as('emp').patch(`/projects/tasks/${t.id}`, { stageId: done.id });
    const card = (await as('emp').get('/projects')).body.projects.find((x) => x.id === p.id);
    expect(card.tasksDone).toBe(1);
  });

  it('messages reach followers; log notes do not', async () => {
    await as('other').post(`/projects/chatter/project/${p.id}/follow`);
    await as('manager').post(`/projects/chatter/project/${p.id}`, { body: 'Internal only', kind: 'NOTE' });
    expect(await prisma.notification.count({ where: { userId: ids.other, type: 'tagged.chatter' } })).toBe(0);
    await as('manager').post(`/projects/chatter/project/${p.id}`, { body: 'Kick-off Monday' });
    expect(await prisma.notification.count({ where: { userId: ids.other, type: 'tagged.chatter' } })).toBe(1);
  });

  it('keeps a risk, issue and change register and schedules activities', async () => {
    expect((await as('emp').post(`/projects/${p.id}/risks`, { kind: 'NOPE', title: 'x' })).status).toBe(400);
    await as('emp').post(`/projects/${p.id}/risks`, { kind: 'RISK', title: 'Vendor delay', severity: 'HIGH' });
    expect((await as('other').get('/projects/risks?kind=RISK')).body.items[0].title).toBe('Vendor delay');
    const a = await as('manager').post(`/projects/chatter/project/${p.id}/activities`, { summary: 'Call client', dueDate: addDays(day, 2), assigneeId: ids.emp });
    expect((await as('emp').get('/projects/dashboard')).body.activities.map((x) => x.summary)).toContain('Call client');
    await as('emp').post(`/projects/activities/${a.body.activity.id}/done`);
    expect((await as('emp').get('/projects/dashboard')).body.activities.map((x) => x.summary)).not.toContain('Call client');
  });
});

describe('ClickUp import', () => {
  const realFetch = global.fetch;
  const routes = {
    '/team': { teams: [{ id: 't1', name: 'Workspace' }] },
    '/team/t1/space?archived=false': { spaces: [{ id: 's1', name: 'Delivery' }] },
    '/space/s1/folder?archived=false': { folders: [{ id: 'f1', name: 'Clients', lists: [{ id: 'l1', name: 'Rollout', task_count: 2 }] }] },
    '/space/s1/list?archived=false': { lists: [] },
    '/list/l1': { id: 'l1', name: 'Rollout', statuses: [{ status: 'to do', orderindex: 0, type: 'open' }, { status: 'complete', orderindex: 1, type: 'closed' }] },
    '/list/l1/task?page=0&include_closed=true&subtasks=true': {
      last_page: true,
      tasks: [
        { id: 'a', name: 'Parent', status: { status: 'to do' }, assignees: [{ email: 'emp@test.co' }, { email: 'stranger@x.co' }], due_date: String(Date.UTC(2027, 0, 15)), time_estimate: 7200000, priority: { priority: 'urgent' }, tags: [{ name: 'ops' }] },
        { id: 'b', name: 'Child', parent: 'a', status: { status: 'complete' }, assignees: [] },
      ],
    },
  };

  beforeAll(() => {
    global.fetch = async (url, opts) => {
      const path = String(url).replace('https://api.clickup.com/api/v2', '');
      if (opts?.headers?.authorization === 'bad') return { ok: false, status: 401 };
      return { ok: true, status: 200, json: async () => routes[path] };
    };
  });
  afterAll(() => { global.fetch = realFetch; });

  it('needs permission and a token that works', async () => {
    expect((await as('emp').get('/projects/import/clickup')).status).toBe(403);
    expect((await as('manager').get('/projects/import/clickup')).body.connected).toBe(false);
    expect((await as('manager').post('/projects/import/clickup/token', { apiToken: 'bad' })).status).toBe(400);
    expect((await as('manager').post('/projects/import/clickup/token', { apiToken: 'pk_good' })).status).toBe(200);
    expect((await as('manager').get('/projects/import/clickup')).body.lists[0]).toMatchObject({ id: 'l1', folder: 'Clients' });
  });

  it('brings the list in as a project with stages, assignees and sub-tasks', async () => {
    const res = await as('manager').post('/projects/import/clickup', { listIds: ['l1'] });
    expect(res.body.results[0]).toMatchObject({ tasks: 2, unmatched: ['stranger@x.co'] });
    const project = await prisma.project.findFirst({ where: { externalId: 'clickup:list:l1' }, include: { taskStages: true, tasks: { include: { assignees: true } } } });
    expect(project.name).toBe('Clients · Rollout');
    expect(project.taskStages.find((s) => s.name === 'Complete').isDone).toBe(true);
    const parent = project.tasks.find((x) => x.name === 'Parent');
    expect(parent.plannedHours).toBe(2);
    expect(parent.priority).toBe(true);
    expect(fromDbDate(parent.deadline)).toBe('2027-01-15');
    expect(parent.assignees.map((a) => a.userId)).toEqual([ids.emp]);
    expect(project.tasks.find((x) => x.name === 'Child').parentId).toBe(parent.id);
  });

  it('re-importing updates instead of duplicating', async () => {
    await as('manager').post('/projects/import/clickup', { listIds: ['l1'] });
    expect(await prisma.task.count({ where: { externalId: { startsWith: 'clickup:' } } })).toBe(2);
    expect(await prisma.project.count({ where: { externalId: 'clickup:list:l1' } })).toBe(1);
  });

  it('imports a CSV export, including quoted commas', async () => {
    const csv = 'Task Name,Status,Assignees,Task Content\n"Fix, then test",Done,emp@test.co,"Line one\nLine two"\nSecond,To Do,,\n';
    const res = await as('manager').post('/projects/import/csv', { csv, projectName: 'From CSV' });
    expect(res.body.result.tasks).toBe(2);
    const task = await prisma.task.findFirst({ where: { name: 'Fix, then test' }, include: { stage: true, assignees: true } });
    expect(task.stage.isDone).toBe(true);
    expect(task.description).toContain('Line two');
    expect(task.assignees).toHaveLength(1);
    expect((await as('manager').post('/projects/import/csv', { csv: 'Foo\n1\n', projectName: 'Bad' })).status).toBe(400);
  });
});

describe('contracts', () => {
  let contract;

  it('is HR only, and starting a new one closes the old one', async () => {
    const body = { userId: ids.emp, startDate: '2024-01-01', wage: 30000 };
    expect((await as('manager').post('/contracts', body)).status).toBe(403);
    expect((await as('emp').get('/contracts')).status).toBe(403);
    expect((await as('hr').post('/contracts', { ...body, wage: 0 })).status).toBe(400);
    const first = await as('hr').post('/contracts', body);
    await as('hr').post(`/contracts/${first.body.contract.id}/start`);
    const second = await as('hr').post('/contracts', { ...body, wage: 30000, probationEnd: addDays(day, 10), workPermitExpiry: addDays(day, 40) });
    contract = second.body.contract;
    await as('hr').post(`/contracts/${contract.id}/start`);
    expect((await prisma.contract.findUnique({ where: { id: first.body.contract.id } })).state).toBe('EXPIRED');
    expect(await prisma.contract.count({ where: { userId: ids.emp, state: 'RUNNING' } })).toBe(1);
    const mine = await as('emp').get('/contracts/my');
    expect(mine.body.contracts).toHaveLength(2);
  });

  it('shows probation and permits on the HR dashboard', async () => {
    const res = await as('hr').get('/dashboard/hr');
    expect(res.body.compliance.probation).toBeGreaterThanOrEqual(1);
    expect(res.body.compliance.permits).toBeGreaterThanOrEqual(1);
  });

  it('alerts HR at the warning dates and expires ended contracts', async () => {
    const { contractAlerts } = require('../lib/jobs');
    await prisma.contract.update({ where: { id: contract.id }, data: { probationEnd: toDbDate(addDays(day, 30)) } });
    await contractAlerts(TZ);
    expect(await prisma.notification.count({ where: { userId: ids.hr, type: 'payroll.contract_alert' } })).toBeGreaterThanOrEqual(1);
  });
});

describe('payroll', () => {
  const { annualTax, ageAt } = require('../lib/payroll');
  const { DEFAULTS } = require('../lib/settings');
  const period = '2026-09';
  let runId;
  let slip;

  it('works out PAYE from the tax table with age rebates', () => {
    expect(annualTax(300000, DEFAULTS.payroll, 40)).toBeCloseTo(41797, 0);
    expect(annualTax(300000, DEFAULTS.payroll, 66)).toBeCloseTo(32353, 0);
    expect(annualTax(90000, DEFAULTS.payroll, 40)).toBe(0);
    expect(annualTax(2000000, DEFAULTS.payroll, 40)).toBeCloseTo(644489 + 183000 * 0.45 - 17235, 0);
    expect(ageAt(toDbDate('1990-12-01'), '2026-09-30')).toBe(35);
  });

  it('is HR only', async () => {
    expect((await as('manager').post('/payroll/runs', { periodStart: `${period}-01`, periodEnd: `${period}-30` })).status).toBe(403);
    expect((await as('emp').get('/payroll/runs')).status).toBe(403);
  });

  it('generates payslips with basic, tax, UIF and net', async () => {
    await as('hr').post('/payroll/rules', { code: 'TRANSPORT', name: 'Transport', category: 'ALLOWANCE', amount: 1000 });
    expect((await as('hr').post('/payroll/rules', { code: 'PAYE', name: 'x', category: 'DEDUCTION' })).status).toBe(409);
    const res = await as('hr').post('/payroll/runs', { periodStart: `${period}-01`, periodEnd: `${period}-30` });
    expect(res.body.payslips).toBe(1);
    runId = res.body.id;
    const run = await as('hr').get(`/payroll/runs/${runId}`);
    [slip] = run.body.payslips;
    const full = (await as('hr').get(`/payroll/payslips/${slip.id}`)).body.payslip;
    const amount = (c) => full.lines.find((l) => l.code === c).amount;
    expect(amount('BASIC')).toBe(30000);
    expect(amount('TRANSPORT')).toBe(1000);
    expect(full.gross).toBe(31000);
    expect(amount('UIF')).toBe(177.12);
    expect(amount('SDL')).toBe(310);
    expect(amount('PAYE')).toBeCloseTo(annualTax(372000, DEFAULTS.payroll, 0) / 12, 1);
    expect(full.net).toBeCloseTo(31000 - amount('PAYE') - 177.12, 1);
  });

  it('keeps hand-added lines when it recomputes', async () => {
    await as('hr').post(`/payroll/payslips/${slip.id}/lines`, { name: 'Bonus', category: 'ALLOWANCE', amount: 2000 });
    await as('hr').post(`/payroll/runs/${runId}/recompute`);
    const full = (await as('hr').get(`/payroll/payslips/${slip.id}`)).body.payslip;
    expect(full.gross).toBe(33000);
    expect(full.lines.filter((l) => l.manual)).toHaveLength(1);
  });

  it('deducts unpaid leave at the daily rate', async () => {
    const unpaid = await prisma.leaveType.create({ data: { name: 'Unpaid', requiresAllocation: false, approvalSteps: 'NONE' } });
    await prisma.leaveRequest.create({ data: { userId: ids.emp, leaveTypeId: unpaid.id, dateFrom: toDbDate('2026-09-15'), dateTo: toDbDate('2026-09-15'), days: 1, state: 'APPROVED' } });
    await as('hr').post(`/payroll/runs/${runId}/recompute`);
    const full = (await as('hr').get(`/payroll/payslips/${slip.id}`)).body.payslip;
    expect(full.unpaidDays).toBe(1);
    expect(full.lines.find((l) => l.code === 'UNPAID').amount).toBeGreaterThan(1000);
    expect(full.gross).toBeLessThan(33000);
    await prisma.leaveRequest.deleteMany({ where: { leaveTypeId: unpaid.id } });
    await prisma.leaveType.update({ where: { id: unpaid.id }, data: { active: false } });
  });

  it('runs draft → verified → published → paid and locks along the way', async () => {
    expect((await as('emp').get('/payroll/my')).body.payslips).toHaveLength(0);
    expect((await as('emp').get(`/payroll/payslips/${slip.id}`)).status).toBe(403);
    expect((await as('hr').post(`/payroll/runs/${runId}/confirm`)).status).toBe(409);
    await as('hr').post(`/payroll/runs/${runId}/verify`);
    expect((await as('hr').post(`/payroll/payslips/${slip.id}/lines`, { name: 'x', category: 'ALLOWANCE', amount: 1 })).status).toBe(423);
    await as('hr').post(`/payroll/runs/${runId}/confirm`);
    expect((await as('emp').get('/payroll/my')).body.payslips).toHaveLength(1);
    expect(await prisma.emailJob.count({ where: { userId: ids.emp, kind: 'payslip' } })).toBe(1);
    await as('hr').post(`/payroll/runs/${runId}/paid`);
    expect((await as('hr').get(`/payroll/runs/${runId}`)).body.run.state).toBe('PAID');
  });

  it('prints a PDF for the owner and keeps it from colleagues', async () => {
    const pdf = await as('emp').get(`/payroll/payslips/${slip.id}/pdf`).buffer().parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.status).toBe(200);
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
    expect((await as('other').get(`/payroll/payslips/${slip.id}/pdf`)).status).toBe(403);
  });
});

describe('appraisals', () => {
  let id;

  it('managers start one for their team; staff cannot', async () => {
    expect((await as('other').post('/appraisals', { userId: ids.emp, deadline: addDays(day, 10) })).status).toBe(403);
    const res = await as('manager').post('/appraisals', { userId: ids.emp, managerId: ids.manager, deadline: addDays(day, 10) });
    expect(res.status).toBe(201);
    id = res.body.id;
    expect(await prisma.notification.count({ where: { userId: ids.emp, type: 'appraisal.requested' } })).toBe(1);
  });

  it('keeps each side private until finished', async () => {
    await as('emp').patch(`/appraisals/${id}`, { employeeFeedback: 'Mine' });
    await as('manager').patch(`/appraisals/${id}`, { managerFeedback: 'Theirs' });
    const find = async (who) => (await as(who).get('/appraisals')).body.appraisals.find((a) => a.id === id);
    expect((await find('emp')).managerFeedback).toBeNull();
    expect((await find('manager')).employeeFeedback).toBeNull();
    await as('emp').post(`/appraisals/${id}/submit`);
    expect((await find('manager')).employeeFeedback).toBe('Mine');
    expect((await find('emp')).managerFeedback).toBeNull();
    expect((await as('other').get('/appraisals')).body.appraisals.find((a) => a.id === id)).toBeUndefined();
    expect((await as('emp').patch(`/appraisals/${id}`, { employeeFeedback: 'Changed' })).status).toBe(423);
  });

  it('only the manager finishes, with a rating, then the employee sees it', async () => {
    expect((await as('emp').post(`/appraisals/${id}/finish`, { rating: 5 })).status).toBe(403);
    expect((await as('manager').post(`/appraisals/${id}/finish`, { rating: 9 })).status).toBe(400);
    await as('manager').post(`/appraisals/${id}/finish`, { rating: 4 });
    const a = (await as('emp').get('/appraisals')).body.appraisals.find((x) => x.id === id);
    expect(a).toMatchObject({ state: 'DONE', rating: 4, managerFeedback: 'Theirs' });
  });

  it('tracks goals with progress', async () => {
    const g = await as('manager').post('/appraisals/goals', { title: 'Ship it', userId: ids.emp });
    await as('emp').patch(`/appraisals/goals/${g.body.goal.id}`, { progress: 150 });
    expect((await as('emp').get('/appraisals/goals')).body.goals[0].progress).toBe(100);
    expect((await as('nosup').get(`/appraisals/goals?userId=${ids.emp}`)).status).toBe(403);
  });
});

describe('branding and email templates', () => {
  it('HR controls logos, colour and templates; staff cannot', async () => {
    expect((await as('emp').put('/settings/branding', { primaryColor: '#000000' })).status).toBe(403);
    expect((await as('hr').put('/settings/branding', { primaryColor: 'red' })).status).toBe(400);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const denied = await request(app).post('/api/files').set('Authorization', `Bearer ${tokens.emp}`).field('purpose', 'branding').attach('file', png, { filename: 'l.png', contentType: 'image/png' });
    expect(denied.status).toBe(403);
    const up = await request(app).post('/api/files').set('Authorization', `Bearer ${tokens.hr}`).field('purpose', 'branding').attach('file', png, { filename: 'l.png', contentType: 'image/png' });
    await as('hr').put('/settings/branding', { logoFileId: up.body.file.id, primaryColor: '#123456', emailFooter: 'Acme Holdings' });
    clearSettingsCache();
    expect((await request(app).get('/api/public/testco/logo/main')).status).toBe(200);
    const pub = await request(app).get('/api/public/testco/branding');
    expect(pub.body).toMatchObject({ primaryColor: '#123456', hasLogo: true, name: 'Test Co' });
  });

  it('the custom logo, footer and wording reach the emails', async () => {
    await as('hr').put('/settings/email-templates/welcome', { subject: 'Joining {{companyName}}', body: 'Hello {{firstName}}, {{hrName}} set you up.' });
    expect((await as('emp').put('/settings/email-templates/welcome', { subject: 'x', body: 'y' })).status).toBe(403);
    expect((await as('hr').put('/settings/email-templates/nope', { subject: 'x', body: 'y' })).status).toBe(404);
    const res = await as('hr').post('/employees', { name: 'Brand Test', email: 'brand@test.co', role: 'EMPLOYEE', startDate: day });
    const job = await prisma.emailJob.findFirst({ where: { userId: res.body.employee.id, kind: 'welcome' } });
    const html = decrypt(job.htmlEnc);
    expect(html).toContain('Hello Brand, hr Person set you up.');
    expect(html).toContain('/api/public/testco/logo/main');
    expect(html).toContain('Acme Holdings');
    expect(html).toContain('#123456');
    expect((await as('hr').get('/settings/email-templates')).body.templates).toHaveLength(4);
  });

  it('puts the logo on the payslip without failing', async () => {
    const slip = await prisma.payslip.findFirst();
    expect((await as('hr').get(`/payroll/payslips/${slip.id}/pdf`)).status).toBe(200);
  });
});

describe('gaps closed', () => {
  it('books January leave against what next year will grant', async () => {
    const { balances } = require('../lib/leave');
    const year = Number(day.slice(0, 4)) + 1;
    const accruing = await prisma.leaveType.create({ data: { name: 'Vacation', accrualPerMonth: 1.25, maxCarryOver: 5, approvalSteps: 'MANAGER' } });
    await prisma.leaveAllocation.create({ data: { userId: ids.other, leaveTypeId: accruing.id, days: 20, periodStart: toDbDate(`${year - 1}-01-01`), periodEnd: toDbDate(`${year - 1}-12-31`) } });
    const line = (await balances(ids.other, year, { asOf: `${year}-02-10` })).find((b) => b.leaveTypeId === accruing.id);
    expect(line.projected).toBe(true);
    expect(line.allocated).toBe(7.5);
    await prisma.leaveType.update({ where: { id: accruing.id }, data: { active: false } });
  });

  it('sends one digest email covering all missed chat, then nothing until there is more', async () => {
    const { sendChatDigests } = require('../lib/jobs');
    await prisma.user.update({ where: { id: ids.other }, data: { chatDigest: true } });
    await prisma.conversationMember.updateMany({ where: { userId: ids.other }, data: { lastReadAt: new Date() } });
    const conv = (await as('emp').post('/chat/direct', { userId: ids.other })).body.conversationId;
    await as('emp').post(`/chat/conversations/${conv}/messages`, { body: 'One' });
    await as('emp').post(`/chat/conversations/${conv}/messages`, { body: 'Two' });
    expect(await prisma.emailJob.count({ where: { userId: ids.other, kind: 'chat.message' } })).toBe(0);
    await sendChatDigests();
    const jobs = await prisma.emailJob.findMany({ where: { userId: ids.other, kind: 'chat.digest' } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].subject).toBe('You have 2 unread messages');
    await sendChatDigests();
    expect(await prisma.emailJob.count({ where: { userId: ids.other, kind: 'chat.digest' } })).toBe(1);
  });

  it('pushes approved leave to a connected calendar and removes it on cancel', async () => {
    const { pushLeave, removePushedLeave } = require('../lib/calendar');
    const { encrypt } = require('../lib/crypto');
    const realFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      calls.push([opts.method || 'GET', String(url)]);
      if (String(url).includes('oauth2')) return { ok: true, status: 200, json: async () => ({ access_token: 'tok' }) };
      return { ok: true, status: 200, json: async () => ({ id: 'evt1' }) };
    };
    await prisma.calendarConnection.create({ data: { userId: ids.other, provider: 'GOOGLE', refreshEnc: encrypt('r'), pushLeave: true } });
    const req = await prisma.leaveRequest.create({ data: { userId: ids.other, leaveTypeId: annual.id, dateFrom: toDbDate('2027-03-01'), dateTo: toDbDate('2027-03-02'), days: 2, state: 'APPROVED' } });
    await pushLeave(req);
    const saved = await prisma.leaveRequest.findUnique({ where: { id: req.id } });
    expect(saved.pushedEvents).toEqual([expect.objectContaining({ eventId: 'evt1' })]);
    await removePushedLeave(saved);
    expect(calls.some(([m, u]) => m === 'DELETE' && u.includes('evt1'))).toBe(true);
    expect((await prisma.leaveRequest.findUnique({ where: { id: req.id } })).pushedEvents).toBeNull();
    global.fetch = realFetch;
    await prisma.leaveRequest.delete({ where: { id: req.id } });
    await prisma.calendarConnection.deleteMany({});
  });
});

describe('company separation', () => {
  let other;
  let otherAdminToken;

  it('the Super Admin creates a company and its admin gets an invite at its own address', async () => {
    expect((await as('hr').post('/system/companies', { name: 'X', adminName: 'A', adminEmail: 'a@x.co' })).status).toBe(403);
    const res = await as('super').post('/system/companies', { name: 'Blue Co', adminName: 'Blue Admin', adminEmail: 'emp@test.co', seats: 3 });
    expect(res.status).toBe(201);
    other = res.body.company;
    expect(other.slug).toBe('blue-co');
    expect((await as('super').post('/system/companies', { name: 'Blue Co', adminName: 'A', adminEmail: 'a@x.co' })).status).toBe(409);
    // New companies hold admins at the 2FA gate; this test admin has no authenticator app.
    await prisma.company.update({ where: { id: other.id }, data: { settings: { security: { adminTwoFactorRequired: false } } } });
    clearSettingsCache();
    const html = await asPlatform(async () => decrypt((await prisma.emailJob.findFirst({ where: { companyId: other.id, kind: 'welcome' } })).htmlEnc));
    expect(html).toContain('/c/blue-co/login?invite=');
    const temp = html.match(/monospace;">([^<]+)</)[1].replace(/&amp;/g, '&');
    const login2 = await login('emp@test.co', temp, 'blue-co');
    expect(login2.status).toBe(200);
    otherAdminToken = login2.body.token;
    tokens.blue = otherAdminToken;
    await as('blue').post('/auth/change-password', { currentPassword: temp, newPassword: PASSWORD });
  });

  it('the same email is two separate accounts, and each only works at its own address', async () => {
    expect((await login('emp@test.co', PASSWORD, 'testco')).body.user.company.slug).toBe('testco');
    expect((await login('emp@test.co', PASSWORD, 'blue-co')).body.user.company.slug).toBe('blue-co');
    expect((await login('manager@test.co', PASSWORD, 'blue-co')).status).toBe(401);
    expect((await login('emp@test.co', PASSWORD, 'nope')).status).toBe(404);
  });

  it('a company sees only its own people, projects and records', async () => {
    const people = await as('blue').get('/employees');
    expect(people.body.employees.map((e) => e.name)).toEqual(['Blue Admin']);
    expect((await as('blue').get(`/employees/${ids.manager}`)).status).toBe(404);
    expect((await as('blue').get(`/people/${ids.emp}`)).status).toBe(404);
    const projects = await as('blue').get('/projects');
    expect(projects.body.projects).toEqual([]);
    expect((await as('blue').get(`/projects/${project.id}`)).status).toBe(404);
    expect((await as('blue').patch(`/projects/${project.id}`, { name: 'Stolen' })).status).toBe(404);
    expect((await as('blue').get('/settings/audit')).body.logs.every((l) => l.actorName !== 'hr Person')).toBe(true);
    expect((await as('blue').get('/roles')).body.roles.some((r) => r.id === ids.roles.SELF.id)).toBe(false);
  });

  it('branding, cards and files stay within a company', async () => {
    await as('blue').put('/settings/branding', { primaryColor: '#1D4ED8' });
    clearSettingsCache();
    expect((await as('blue').get('/auth/me')).body.user.branding.primaryColor).toBe('#1D4ED8');
    expect((await as('hr').get('/auth/me')).body.user.branding.primaryColor).toBe('#123456');
    const file = await prisma.fileObject.findFirst();
    expect((await as('blue').get(`/files/${file.id}`)).status).toBe(404);
  });

  it('suspending a company ends its sessions and blocks sign-in', async () => {
    await as('super').patch(`/system/companies/${other.id}`, { active: false });
    expect((await as('blue').get('/auth/me')).status).toBeGreaterThanOrEqual(401);
    expect((await login('emp@test.co', PASSWORD, 'blue-co')).status).toBe(403);
    await as('super').patch(`/system/companies/${other.id}`, { active: true });
    tokens.blue = (await login('emp@test.co', PASSWORD, 'blue-co')).body.token;
  });

  it('seats are per company', async () => {
    await as('blue').post('/employees', { name: 'Two', email: 'two@b.co', startDate: day });
    await as('blue').post('/employees', { name: 'Three', email: 'three@b.co', startDate: day });
    expect((await as('blue').post('/employees', { name: 'Four', email: 'four@b.co', startDate: day })).status).toBe(409);
  });

  it('refuses a query that has no company context', async () => {
    setFallbackCompany(null);
    await expect(prisma.user.findMany()).rejects.toThrow('no company context');
    setFallbackCompany(ids.company);
  });
});

describe('company-defined roles', () => {
  let role;

  it('creates a custom role whose screens decide what the API allows', async () => {
    const res = await as('hr').post('/roles', { name: 'Fleet Lead', scope: 'SELF', permissions: ['module.attendance', 'module.chat'] });
    role = res.body.role;
    await as('hr').patch(`/employees/${ids.nosup}`, { roleId: role.id });
    const { clearPermissionCache } = require('../lib/permissions');
    clearPermissionCache();
    const me = await as('nosup').get('/auth/me');
    expect(me.body.user.roleName).toBe('Fleet Lead');
    expect(me.body.user.permissions['module.leave']).toBe(false);
    expect((await as('nosup').get('/leave/requests')).status).toBe(403);
    expect((await as('nosup').get('/projects')).status).toBe(403);
    expect((await as('nosup').get('/attendance/status')).status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: ids.nosup } })).role).toBe('EMPLOYEE');
  });

  it('changing the scope updates everyone in the role', async () => {
    await as('hr').patch(`/roles/${role.id}`, { scope: 'DEPARTMENT' });
    expect((await prisma.user.findUnique({ where: { id: ids.nosup } })).role).toBe('MANAGER');
  });

  it('a role in use cannot be deleted, and the owner role is protected', async () => {
    expect((await as('hr').delete(`/roles/${role.id}`)).status).toBe(409);
    await as('hr').patch(`/employees/${ids.nosup}`, { roleId: ids.roles.SELF.id });
    expect((await as('hr').delete(`/roles/${role.id}`)).status).toBe(200);
    expect((await as('hr').delete(`/roles/${ids.roles.COMPANY.id}`)).status).toBe(409);
    await as('hr').patch(`/roles/${ids.roles.COMPANY.id}`, { permissions: [] });
    const { clearPermissionCache } = require('../lib/permissions');
    clearPermissionCache();
    expect((await as('hr').get('/auth/me')).body.user.permissions['roles.manage']).toBe(true);
    await as('hr').patch(`/roles/${ids.roles.COMPANY.id}`, { permissions: STARTER_ROLES[0].permissions });
    clearPermissionCache();
  });

  it('nobody grants access they do not hold', async () => {
    const lead = await as('hr').post('/roles', { name: 'People Helper', scope: 'SELF', permissions: ['users.manage', 'users.assign', 'roles.manage'] });
    await as('hr').patch(`/employees/${ids.other}`, { roleId: lead.body.role.id });
    const { clearPermissionCache } = require('../lib/permissions');
    clearPermissionCache();
    expect((await as('other').post('/roles', { name: 'Sneaky', permissions: ['payroll.manage'] })).status).toBe(403);
    expect((await as('other').patch(`/employees/${ids.emp}`, { roleId: ids.roles.COMPANY.id })).status).toBe(403);
    await as('hr').patch(`/employees/${ids.other}`, { roleId: ids.roles.SELF.id });
    clearPermissionCache();
  });

  it('admins and HR can open timesheets, and staff can pick names', async () => {
    expect((await as('hr').get('/timesheets/grid')).status).toBe(200);
    const names = await as('emp').get('/timesheets/people');
    expect(names.body.people.map((p) => p.name)).toContain('other Person');
  });
});

describe('workflows', () => {
  it('a company-built chain routes leave to a named role, then a person', async () => {
    const approvers = await as('hr').post('/roles', { name: 'Leave Desk', scope: 'SELF', permissions: ['module.leave', 'leave.approve'] });
    await as('hr').patch(`/employees/${ids.other}`, { roleId: approvers.body.role.id });
    const { clearPermissionCache } = require('../lib/permissions');
    clearPermissionCache();
    const wf = await as('hr').post('/settings/workflows', { name: 'Two desk', appliesTo: 'LEAVE', steps: [{ kind: 'ROLE', roleId: approvers.body.role.id }, { kind: 'USER', userId: ids.manager }] });
    expect(wf.status).toBe(201);
    expect((await as('hr').post('/settings/workflows', { name: 'Bad', appliesTo: 'LEAVE', steps: [] })).status).toBe(400);
    const type = await prisma.leaveType.create({ data: { name: 'Desk leave', requiresAllocation: false, workflowId: wf.body.workflow.id } });
    const date = futureWeekday(90);
    const res = await as('emp').post('/leave/requests', { leaveTypeId: type.id, dateFrom: date, dateTo: date });
    const id = res.body.request.id;
    expect((await as('lead').post(`/leave/requests/${id}/approve`, {})).status).toBe(403);
    const one = await as('other').post(`/leave/requests/${id}/approve`, {});
    expect(one.body.request.state).toBe('PARTLY_APPROVED');
    expect((await as('other').post(`/leave/requests/${id}/approve`, {})).status).toBe(403);
    const two = await as('manager').post(`/leave/requests/${id}/approve`, {});
    expect(two.body.request.state).toBe('APPROVED');
    await as('hr').patch(`/employees/${ids.other}`, { roleId: ids.roles.SELF.id });
    await prisma.leaveType.update({ where: { id: type.id }, data: { active: false } });
    clearPermissionCache();
  });
});

describe('employee records', () => {
  it('HR captures the full record when creating someone', async () => {
    const res = await as('hr').post('/employees', {
      firstName: 'Full', lastName: 'Record', email: 'full@test.co', startDate: day,
      profile: {
        salutation: 'Mr.', gender: 'Male', nationality: 'Congolese', race: 'African', maritalStatus: 'Single', bloodGroup: 'O+', birthDate: '1995-02-24', idNumber: '9502245555088', passportNumber: 'A123', permitExpiry: '2030-01-01',
        address: '810 Cora Avenue', city: 'Pretoria', state: 'Gauteng', zipCode: '0182', country: 'South Africa', presentAddress: '1 Main', homePhone: '011', officePhone: '012', phone: '069', emergencyName: 'Ota', emergencyRelation: 'Parent', emergencyPhone: '069', emergencyEmail: 'o@x.co',
        bankName: 'FNB', bankAccount: '6281009021', dependents: [{ name: 'Ana', relation: 'Child' }], workExperience: [{ company: 'Acme', title: 'Dev' }], qualifications: [{ name: 'BSc' }], memberships: [{ name: 'IITPSA' }],
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.employee.name).toBe('Full Record');
    const id = res.body.employee.id;
    const p = (await as('hr').get(`/profile/${id}`)).body.profile;
    expect(p).toMatchObject({ gender: 'Male', city: 'Pretoria', permitExpiry: '2030-01-01', bankName: 'FNB', emergencyEmail: 'o@x.co' });
    expect(p.dependents[0].name).toBe('Ana');
    expect(p.idNumber).not.toContain('950224');
    const stored = await prisma.profile.findFirst({ where: { userId: id } });
    expect(stored.bankAccountEnc).not.toContain('6281');
  });

  it('employees edit their own contact details; HR hears about it', async () => {
    await as('emp').patch('/profile/me', { city: 'Soweto', dependents: [{ name: 'Kid' }] });
    const me = (await as('emp').get('/profile/me')).body.profile;
    expect(me.city).toBe('Soweto');
    expect(me.dependents).toEqual([{ name: 'Kid' }]);
  });

  it('keeps employee documents', async () => {
    const png = Buffer.from('iVBORw0KGgo=', 'base64');
    const up = await request(app).post('/api/files').set('Authorization', `Bearer ${tokens.emp}`).field('purpose', 'profile').attach('file', png, { filename: 'id.png', contentType: 'image/png' });
    const doc = await as('emp').post(`/profile/${ids.emp}/documents`, { name: 'ID copy', fileId: up.body.file.id });
    expect(doc.status).toBe(201);
    expect((await as('other').post(`/profile/${ids.emp}/documents`, { name: 'x', fileId: 1 })).status).toBe(403);
    expect((await as('emp').get(`/profile/${ids.emp}/documents`)).body.documents).toHaveLength(1);
  });
});

describe('digital cards and kiosk', () => {
  let token;

  it('issues a card with a QR code using the company design', async () => {
    await as('hr').put('/settings/card-design', { widthMm: 90, heightMm: 55, accentColor: '#0000FF', title: 'Staff ID' });
    clearSettingsCache();
    const res = await as('emp').get('/cards/me');
    expect(res.body.design).toMatchObject({ widthMm: 90, accentColor: '#0000FF', title: 'Staff ID' });
    expect(res.body.qr).toMatch(/^data:image\/png/);
    token = res.body.token;
    expect((await as('hr').put('/settings/card-design', { widthMm: 5 })).status).toBe(400);
    expect((await as('emp').put('/settings/card-design', { widthMm: 90 })).status).toBe(403);
  });

  it('a phone can confirm a card without signing in', async () => {
    const res = await request(app).get(`/api/public/card/${token}`);
    expect(res.body).toMatchObject({ name: 'emp Person', valid: true });
    expect(JSON.stringify(res.body)).not.toContain('@');
  });

  it('scanning checks in, then out, and ignores a double scan', async () => {
    await prisma.attendance.updateMany({ where: { userId: ids.emp, openUserId: { not: null } }, data: { openUserId: null, checkOut: new Date() } });
    await prisma.user.update({ where: { id: ids.emp }, data: { lastCardScanAt: null } });
    expect((await as('emp').post('/attendance/scan', { token })).status).toBe(403);
    const first = await as('hr').post('/attendance/scan', { token: `https://app/card/${token}` });
    expect(first.body).toMatchObject({ action: 'in', name: 'emp Person' });
    expect((await prisma.attendance.findFirst({ where: { openUserId: ids.emp } })).source).toBe('CARD');
    expect((await as('hr').post('/attendance/scan', { token })).body.action).toBe('repeat');
    await prisma.user.update({ where: { id: ids.emp }, data: { lastCardScanAt: null } });
    expect((await as('hr').post('/attendance/scan', { token })).body.action).toBe('out');
  });

  it('a card from another company is not valid here, and a reissued card stops working', async () => {
    const blueCard = await as('blue').get('/cards/me');
    expect((await as('hr').post('/attendance/scan', { token: blueCard.body.token })).status).toBe(404);
    await as('hr').post(`/cards/${ids.emp}/reissue`);
    expect((await as('hr').post('/attendance/scan', { token })).status).toBe(404);
  });
});

describe('email designer', () => {
  it('uses the colours, heading, button and image a company picked', async () => {
    await as('hr').put('/settings/email-templates/welcome', { subject: 'Hi', body: 'Text', design: { heading: 'Welcome to the team', buttonText: 'Get started', buttonColor: '#00FF00', backgroundColor: '#112233', headerImageId: 7 } });
    const res = await as('hr').post('/employees', { name: 'Design Test', email: 'design@test.co', startDate: day });
    const html = decrypt((await prisma.emailJob.findFirst({ where: { userId: res.body.employee.id, kind: 'welcome' } })).htmlEnc);
    expect(html).toContain('Welcome to the team');
    expect(html).toContain('Get started');
    expect(html).toContain('#00FF00');
    expect(html).toContain('#112233');
    expect(html).toContain('/api/public/testco/image/7');
  });
});

describe('company name and logo', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  let company;

  test('only the Super Admin can set a logo, and it must be an image', async () => {
    const res = await request(app).post('/api/system/companies').set('Authorization', `Bearer ${tokens.super}`)
      .field({ name: 'Logo Co', adminName: 'Logo Admin', adminEmail: 'logo@test.co', seats: 10 }).attach('file', PNG, 'l.png');
    expect(res.status).toBe(201);
    company = res.body.company;
    expect(company.hasLogo).toBe(true);
    const url = `/api/system/companies/${company.id}/logo`;
    expect((await request(app).post(url).set('Authorization', `Bearer ${tokens.hr}`).attach('file', PNG, 'l.png')).status).toBe(403);
    expect((await request(app).post(url).set('Authorization', `Bearer ${tokens.super}`).attach('file', Buffer.from('hi'), 'l.txt')).status).toBe(415);
    expect((await request(app).post(url).set('Authorization', `Bearer ${tokens.super}`).attach('file', PNG, 'l.png')).status).toBe(200);
  });

  test('the logo is served from the company link, and a new company starts with the default', async () => {
    const res = await request(app).get('/api/public/logo-co/logo/main');
    expect(res.status).toBe(200);
    expect((await request(app).get('/api/public/logo-co/branding')).body).toMatchObject({ name: 'Logo Co', hasLogo: true });
    const plain = (await as('super').post('/system/companies', { name: 'Plain Co', adminName: 'P', adminEmail: 'p@test.co' })).body.company;
    expect((await request(app).get(`/api/public/${plain.slug}/branding`)).body.hasLogo).toBe(false);
  });

  test('emails carry the company name, not the product name', async () => {
    const job = await runAs(company.id, async () => { const row = await prisma.emailJob.findFirst({ where: { kind: 'welcome' } }); return row; });
    expect(job.subject).toBe('Welcome to Logo Co — your sign-in details');
    const html = decrypt(job.htmlEnc);
    expect(html).toContain('Logo Co');
    expect(html).not.toContain('NkashHeaven');
    expect(html).toContain('/api/public/logo-co/logo/main');
  });

  test('a company admin can rename the company from branding', async () => {
    const { branding } = (await as('hr').get('/settings/branding')).body;
    expect((await as('hr').put('/settings/branding', { ...branding, companyName: '  ' })).status).toBe(400);
    expect((await as('hr').put('/settings/branding', { ...branding, companyName: 'Renamed Co' })).status).toBe(200);
    expect((await request(app).get('/api/public/testco/branding')).body.name).toBe('Renamed Co');
    await as('hr').put('/settings/branding', { ...branding, companyName: 'Test Co' });
  });
});

describe('anyone can lead', () => {
  const put = (id, body) => as('hr').patch(`/employees/${id}`, body);

  it('offers every active person as a manager', async () => {
    const { managers } = (await as('hr').get('/employees/options')).body;
    expect(managers.map((p) => p.id)).toContain(ids.emp);
  });

  it('an Employee who manages someone can approve for them, and loses that when they stop', async () => {
    expect((await as('emp').get('/approvals')).status).toBe(403);
    await put(ids.other, { managerId: ids.emp });
    expect((await as('emp').get('/auth/me')).body.user.leadsPeople).toBe(true);

    const date = futureWeekday(120);
    const req = await as('other').post('/leave/requests', { leaveTypeId: annual.id, dateFrom: date, dateTo: date });
    expect(req.status).toBe(201);
    const inbox = await as('emp').get('/approvals');
    expect(inbox.status).toBe(200);
    expect(inbox.body.leave.map((r) => r.id)).toContain(req.body.request.id);
    const step = await as('emp').post(`/leave/requests/${req.body.request.id}/approve`, {});
    expect(step.body.request.state).toBe('PARTLY_APPROVED');
    expect((await as('emp').post(`/leave/requests/${req.body.request.id}/approve`, {})).status).toBe(403);
    const done = await as('hr').post(`/leave/requests/${req.body.request.id}/approve`, {});
    expect(done.body.request.state).toBe('APPROVED');
    // Their manager can reopen it.
    expect((await as('emp').post(`/leave/requests/${req.body.request.id}/reset`, {})).status).toBe(200);
    await as('other').delete(`/leave/requests/${req.body.request.id}`, {});

    await put(ids.other, { managerId: ids.lead });
    expect((await as('emp').get('/auth/me')).body.user.leadsPeople).toBe(false);
    expect((await as('emp').get('/approvals')).status).toBe(403);
  });

  it('an Employee named in a workflow sees and decides that request', async () => {
    const wf = await as('hr').post('/settings/workflows', { name: 'Named person', appliesTo: 'LEAVE', steps: [{ kind: 'USER', userId: ids.nosup }] });
    const type = await prisma.leaveType.create({ data: { name: 'Named leave', requiresAllocation: false, workflowId: wf.body.workflow.id } });
    const date = futureWeekday(130);
    const req = await as('other').post('/leave/requests', { leaveTypeId: type.id, dateFrom: date, dateTo: date });
    expect((await as('nosup').get('/approvals')).body.leave.map((r) => r.id)).toContain(req.body.request.id);
    expect((await as('nosup').post(`/leave/requests/${req.body.request.id}/approve`, {})).body.request.state).toBe('APPROVED');
    await prisma.leaveType.update({ where: { id: type.id }, data: { active: false } });
    await as('hr').delete(`/settings/workflows/${wf.body.workflow.id}`, {});
  });
});

describe('HR and individual access', () => {
  it('HR changes managers but cannot make anyone HR or touch HR and admin accounts', async () => {
    const options = (await as('hrstaff').get('/employees/options')).body;
    expect(options.roles.some((r) => r.scope === 'COMPANY')).toBe(false);
    expect((await as('hrstaff').patch(`/employees/${ids.nosup}`, { managerId: ids.lead })).status).toBe(200);
    expect((await as('hrstaff').patch(`/employees/${ids.nosup}`, { roleId: ids.roles.HR.id })).status).toBe(403);
    expect((await as('hrstaff').patch(`/employees/${ids.hr}`, { jobTitle: 'Nope' })).status).toBe(403);
    expect((await as('hrstaff').post(`/employees/${ids.hr}/archive`)).status).toBe(403);
    const created = await as('hrstaff').post('/employees', { name: 'New HR', email: 'newhr@test.co', roleId: ids.roles.HR.id, startDate: day });
    expect(created.status).toBe(403);
    expect((await as('hr').get(`/employees/${ids.hrstaff}`)).body.manageable).toBe(true);
    expect((await as('hrstaff').get(`/employees/${ids.hr}`)).body.manageable).toBe(false);
    await as('hrstaff').patch(`/employees/${ids.nosup}`, { managerId: ids.manager });
  });

  it('switches a screen off for one person only, and the company admin cannot be tweaked', async () => {
    const { clearPermissionCache } = require('../lib/permissions');
    expect((await as('hrstaff').put(`/employees/${ids.hr}/access`, { overrides: { 'module.payslips': false } })).status).toBe(403);
    expect((await as('hr').put(`/employees/${ids.hr}/access`, { overrides: {} })).status).toBe(403);
    const res = await as('hrstaff').put(`/employees/${ids.other}/access`, { overrides: { 'module.payslips': false, 'module.chat': true } });
    expect(res.status).toBe(200);
    expect(res.body.overrides).toEqual({ 'module.payslips': false });
    clearPermissionCache();
    expect((await as('other').get('/auth/me')).body.user.permissions['module.payslips']).toBe(false);
    expect((await as('emp').get('/auth/me')).body.user.permissions['module.payslips']).toBe(true);
    expect((await as('manager').put(`/employees/${ids.other}/access`, { overrides: { 'module.payslips': true } })).status).toBe(403);
    await as('hrstaff').put(`/employees/${ids.other}/access`, { overrides: {} });
    expect((await as('other').get('/auth/me')).body.user.permissions['module.payslips']).toBe(true);
  });

  it('HR is an approver for the HR step of leave', async () => {
    const date = futureWeekday(140);
    const req = await as('nosup').post('/leave/requests', { leaveTypeId: annual.id, dateFrom: date, dateTo: date });
    await as('manager').post(`/leave/requests/${req.body.request.id}/approve`, {});
    expect((await as('hrstaff').post(`/leave/requests/${req.body.request.id}/approve`, {})).body.request.state).toBe('APPROVED');
    await as('nosup').post(`/leave/requests/${req.body.request.id}/cancel`);
  });
});

describe('HR manages roles', () => {
  it('edits ordinary roles but not the owner role or company-wide scope', async () => {
    const { clearPermissionCache } = require('../lib/permissions');
    clearPermissionCache();
    const employee = ids.roles.Employee;
    expect((await as('hrstaff').patch(`/roles/${employee.id}`, { description: 'Staff' })).status).toBe(200);
    expect((await as('hrstaff').patch(`/roles/${employee.id}`, { scope: 'COMPANY' })).status).toBe(403);
    expect((await as('hrstaff').patch(`/roles/${ids.roles.COMPANY.id}`, { name: 'Taken over' })).status).toBe(403);
    expect((await as('hrstaff').delete(`/roles/${ids.roles.HR.id}`)).status).toBe(403);
    const made = await as('hrstaff').post('/roles', { name: 'Intern', scope: 'SELF', permissions: ['module.attendance'] });
    expect(made.status).toBe(201);
    expect((await as('hrstaff').post('/roles', { name: 'Shadow HR', scope: 'COMPANY' })).status).toBe(403);
    expect((await as('hrstaff').delete(`/roles/${made.body.role.id}`)).status).toBe(200);
  });

  it('only people who manage roles or access can read them', async () => {
    expect((await as('emp').get('/roles')).status).toBe(403);
    expect((await as('lead').get('/roles')).status).toBe(403);
    expect((await as('hrstaff').get('/roles')).status).toBe(200);
  });

  it('role names stay unique, with a clear reason', async () => {
    const res = await as('hr').patch(`/roles/${ids.roles.COMPANY.id}`, { name: ids.roles.HR.name });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already exists');
  });
});

describe('test case fixes', () => {
  it('a screen switched off for one person is off in the API too', async () => {
    const off = (key) => as('hr').put(`/employees/${ids.other}/access`, { overrides: { [key]: false } });
    await off('module.payslips');
    expect((await as('other').get('/payroll/my')).status).toBe(403);
    await off('module.timesheets');
    expect((await as('other').get('/timesheets/grid')).status).toBe(403);
    await as('hr').put(`/employees/${ids.other}/access`, { overrides: {} });
    expect((await as('other').get('/payroll/my')).status).toBe(200);
  });

  it('a manager-only leave type stays with the manager', async () => {
    const study = await prisma.leaveType.create({ data: { name: 'Manager Only', requiresAllocation: false, approvalSteps: 'MANAGER' } });
    const date = futureWeekday(170);
    const { id } = (await as('nosup').post('/leave/requests', { leaveTypeId: study.id, dateFrom: date, dateTo: date })).body.request;
    expect((await as('hrstaff').get('/leave/inbox')).body.requests.some((r) => r.id === id)).toBe(false);
    expect((await as('hrstaff').post(`/leave/requests/${id}/approve`, {})).status).toBe(403);
    expect((await as('manager').get('/leave/inbox')).body.requests.some((r) => r.id === id)).toBe(true);
    expect((await as('manager').post(`/leave/requests/${id}/approve`, {})).body.request.state).toBe('APPROVED');
    await as('nosup').post(`/leave/requests/${id}/cancel`);
  });

  it('history and audit show labels and names, not ids', async () => {
    const before = (await as('hr').get(`/employees/${ids.other}`)).body.employee;
    await as('hr').patch(`/employees/${ids.other}`, { managerId: ids.nosup, jobTitle: 'Renamed Title' });
    const { history } = (await as('hr').get(`/employees/${ids.other}`)).body;
    const manager = history.find((x) => x.field === 'Manager');
    expect(manager.newValue).toBe((await prisma.user.findUnique({ where: { id: ids.nosup } })).name);
    expect(history.find((x) => x.field === 'Position').newValue).toBe('Renamed Title');
    const log = (await as('hr').get('/settings/audit')).body.logs.find((l) => l.action === 'user.updated');
    expect(log.after).toMatchObject({ Manager: manager.newValue, Position: 'Renamed Title' });
    await as('hr').patch(`/employees/${ids.other}`, { managerId: before.manager?.id ?? null, jobTitle: before.jobTitle });
  });

  it('whoever starts an appraisal as the manager is told too', async () => {
    const res = await as('lead').post('/appraisals', { userId: ids.emp, deadline: addDays(day, 12) });
    expect(res.status).toBe(201);
    const lead = (await prisma.appraisal.findUnique({ where: { id: res.body.id } })).managerId;
    expect(await prisma.notification.count({ where: { userId: lead, type: 'appraisal.requested' } })).toBeGreaterThan(0);
  });
});

describe('company invites and deletion', () => {
  const create = async (name) => {
    const res = await as('super').post('/system/companies', { name, adminName: 'First Admin', adminEmail: 'first@test.co' });
    expect(res.status).toBe(201);
    return res.body.company;
  };

  it('sends the welcome email during the request where no background job runs', async () => {
    process.env.RUN_JOBS = 'false';
    try {
      const res = await as('super').post('/system/companies', { name: 'Instant Co', adminName: 'A', adminEmail: 'instant@test.co' });
      expect(res.body.inviteSent).toBe(true);
      const job = await asPlatform(async () => await prisma.emailJob.findFirst({ where: { companyId: res.body.company.id, kind: 'welcome' } }));
      expect(job.status).toBe('SENT');
    } finally {
      process.env.RUN_JOBS = 'true';
    }
  });

  it('resends the admin a new temporary password until they activate', async () => {
    const company = await create('Resend Co');
    const jobs = () => asPlatform(async () => await prisma.emailJob.count({ where: { companyId: company.id, kind: 'welcome' } }));
    expect((await as('hr').post(`/system/companies/${company.id}/resend-invite`)).status).toBe(403);
    const before = await jobs();
    const res = await as('super').post(`/system/companies/${company.id}/resend-invite`);
    expect(res.status).toBe(200);
    expect(await jobs()).toBe(before + 1);
    await asPlatform(async () => { await prisma.user.updateMany({ where: { companyId: company.id }, data: { inviteStatus: 'ACTIVATED' } }); });
    expect((await as('super').post(`/system/companies/${company.id}/resend-invite`)).status).toBe(409);
  });

  it('only the Super Admin can delete a company, and never the platform', async () => {
    const company = await create('Guarded Co');
    expect((await as('hr').delete(`/system/companies/${company.id}`)).status).toBe(403);
    const platform = await asPlatform(async () => await prisma.company.findFirst({ where: { isPlatform: true } }));
    expect((await as('super').delete(`/system/companies/${platform.id}`)).status).toBe(404);
    expect((await as('super').delete('/system/companies/99999999')).status).toBe(404);
  });

  it('removes everything a company owns and nothing from anyone else', async () => {
    const company = await create('Doomed Co');
    const keep = await create('Kept Co');
    const fill = (id) => runAs(id, async () => {
      const user = await prisma.user.findFirst({});
      const project = await prisma.project.create({ data: { name: 'P' } });
      const task = await prisma.task.create({ data: { name: 'T', projectId: project.id } });
      await prisma.taskAssignee.create({ data: { taskId: task.id, userId: user.id } });
      await prisma.projectFavorite.create({ data: { projectId: project.id, userId: user.id } });
      await prisma.follower.create({ data: { entity: 'task', entityId: task.id, userId: user.id } });
      await prisma.user.update({ where: { id: user.id }, data: { managerId: user.id } });
      return { user, task };
    });
    const doomed = await fill(company.id);
    const kept = await fill(keep.id);

    expect((await as('super').delete(`/system/companies/${company.id}`)).status).toBe(200);

    const tables = Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === 'companyId')).map((m) => m.name);
    for (const table of tables) {
      const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE companyId = ?`, company.id);
      expect([table, Number(n)]).toEqual([table, 0]);
    }
    const [a, b] = await asPlatform(() => Promise.all([prisma.taskAssignee.count({ where: { taskId: doomed.task.id } }), prisma.follower.count({ where: { userId: doomed.user.id } })]));
    expect([a, b]).toEqual([0, 0]);
    await asPlatform(async () => {
      expect(await prisma.company.findUnique({ where: { id: company.id } })).toBeNull();
      expect(await prisma.company.findUnique({ where: { id: keep.id } })).not.toBeNull();
      expect(await prisma.taskAssignee.count({ where: { taskId: kept.task.id } })).toBe(1);
      expect(await prisma.user.count({ where: { companyId: keep.id } })).toBe(1);
    });
    // Foreign key checks must be back on for whichever request uses the connection next.
    const rows = await Promise.all([1, 2, 3, 4].map(() => prisma.$queryRawUnsafe('SELECT @@FOREIGN_KEY_CHECKS AS fk')));
    rows.forEach(([{ fk }]) => expect(Number(fk)).toBe(1));
  });
});

describe('first sign-in details', () => {
  const viewOf = async (where) => asPlatform(async () => {
    const user = await prisma.user.findFirst({ where });
    return runAs(user.companyId, () => userView(user));
  });

  it('asks the company admin only', async () => {
    const company = (await as('super').post('/system/companies', { name: 'Setup Co', adminName: 'Owner', adminEmail: 'owner@test.co' })).body.company;
    expect((await viewOf({ companyId: company.id })).setupCompleted).toBe(false);
    await asPlatform(async () => { await prisma.user.updateMany({ where: { id: ids.emp }, data: { setupCompleted: false } }); });
    expect((await viewOf({ id: ids.emp })).setupCompleted).toBe(true);
  });

  it('shows a saved date of birth in full to its owner and HR, but not to their manager', async () => {
    await asPlatform(async () => { await prisma.profile.update({ where: { userId: ids.emp }, data: { birthDate: null } }); });
    expect((await as('emp').patch('/profile/me', { birthDate: '1995-03-12', emergencyName: 'Sam' })).status).toBe(200);
    const mine = (await as('emp').get('/profile/me')).body.profile;
    expect(mine.birthDate).toBe('1995-03-12');
    expect(mine.emergencyName).toBe('Sam');
    expect((await as('hr').get(`/profile/${ids.emp}`)).body.profile.birthDate).toBe('1995-03-12');
    const lead = await as('lead').get(`/profile/${ids.emp}`);
    expect(lead.status).toBe(200);
    expect(lead.body.profile.birthDate).toBeUndefined();
  });

  it('saving the profile again does not send an unchanged date of birth to HR', async () => {
    const before = await asPlatform(async () => await prisma.changeRequest.count({ where: { userId: ids.emp } }));
    const res = await as('emp').patch('/profile/me', { birthDate: '1995-03-12' });
    expect(res.body.pendingRequest).toBeNull();
    expect(await asPlatform(async () => await prisma.changeRequest.count({ where: { userId: ids.emp } }))).toBe(before);
  });
});

describe('name fields', () => {
  it('splits a name typed on one line', () => {
    const { splitName, fullName } = require('../lib/names');
    expect(splitName('Thabo van der Merwe')).toEqual({ firstName: 'Thabo', lastName: 'van der Merwe' });
    expect(splitName('Cher')).toEqual({ firstName: 'Cher', lastName: null });
    expect(fullName({ firstName: 'Ann', middleName: null, lastName: 'Lee' })).toBe('Ann Lee');
  });

  it('HR sets the three names and the account name follows', async () => {
    const res = await as('hr').post('/employees', { firstName: 'Nomsa', lastName: 'Dube', name: 'Nomsa Grace Dube', email: 'nomsa@test.co', startDate: '2026-10-01', jobTitle: 'Clerk', profile: { firstName: 'Nomsa', middleName: 'Grace', lastName: 'Dube' } });
    expect(res.status).toBe(201);
    const id = res.body.employee.id;
    const seen = (await as('hr').get(`/profile/${id}`)).body.profile;
    expect([seen.firstName, seen.middleName, seen.lastName, seen.name]).toEqual(['Nomsa', 'Grace', 'Dube', 'Nomsa Grace Dube']);
    await as('hr').patch(`/employees/${id}`, { profile: { middleName: '' } });
    expect((await as('hr').get(`/profile/${id}`)).body.profile.name).toBe('Nomsa Dube');
  });

  it('an employee adds a middle name at once, but a new surname waits for HR', async () => {
    await asPlatform(async () => { await prisma.profile.update({ where: { userId: ids.emp }, data: { firstName: 'Lee', middleName: null, lastName: 'Old' } }); });
    await as('emp').patch('/profile/me', { middleName: 'Mid' });
    expect((await as('emp').get('/profile/me')).body.profile.name).toBe('Lee Mid Old');
    const res = await as('emp').patch('/profile/me', { lastName: 'New' });
    expect(res.body.pendingRequest).toBeTruthy();
    expect((await as('emp').get('/profile/me')).body.profile.lastName).toBe('Old');
    expect((await as('hr').post(`/profile/requests/${res.body.pendingRequest}/approve`)).status).toBe(200);
    expect((await as('emp').get('/profile/me')).body.profile.name).toBe('Lee Mid New');
  });

  it('the company admin changes their own details without an approver', async () => {
    const company = (await as('super').post('/system/companies', { name: 'Owner Co', adminName: 'Olive Oak', adminEmail: 'olive@test.co' })).body.company;
    const owner = await asPlatform(async () => await prisma.user.findFirst({ where: { companyId: company.id } }));
    const { token } = await runAs(company.id, async () => require('../api/routes/auth').createSession({ headers: {}, ip: '127.0.0.1' }, owner, false));
    await asPlatform(async () => { await prisma.user.update({ where: { id: owner.id }, data: { mustChangePassword: false } }); await prisma.company.update({ where: { id: company.id }, data: { settings: { security: { adminTwoFactorRequired: false } } } }); });
    clearSettingsCache();
    const auth = (r) => r.set('Authorization', `Bearer ${token}`);
    const res = await auth(request(app).patch('/api/profile/me')).send({ lastName: 'Pine', birthDate: '1990-01-02' });
    expect(res.status).toBe(200);
    expect(res.body.pendingRequest).toBeNull();
    expect(res.body.profile.name).toBe('Olive Pine');
    await auth(request(app).patch('/api/profile/me')).send({ birthDate: '1991-02-03' });
    expect((await auth(request(app).get('/api/profile/me'))).body.profile.birthDate).toBe('1991-02-03');
  });
});

describe('editing departments and teams', () => {
  it('renames a department and its chat channel, and refuses a blank or taken name', async () => {
    const dept = (await as('hr').post('/settings/departments', { name: 'Old Dept' })).body.department;
    const other = (await as('hr').post('/settings/departments', { name: 'Taken Dept' })).body.department;
    expect((await as('hr').patch(`/settings/departments/${dept.id}`, { name: 'New Dept', managerId: ids.lead })).status).toBe(200);
    const list = (await as('hr').get('/settings/departments')).body.departments.find((d) => d.id === dept.id);
    expect(list.name).toBe('New Dept');
    expect(list.manager.id).toBe(ids.lead);
    const channel = await asPlatform(async () => await prisma.conversation.findFirst({ where: { departmentId: dept.id } }));
    expect(channel.name).toBe('new-dept');
    expect((await as('hr').patch(`/settings/departments/${dept.id}`, { name: '   ' })).status).toBe(400);
    expect((await as('hr').patch(`/settings/departments/${dept.id}`, { name: other.name })).status).toBe(409);
    expect((await as('emp').patch(`/settings/departments/${dept.id}`, { name: 'Nope' })).status).toBe(403);
  });

  it('edits a team, including moving it and clearing its lead', async () => {
    const dept = (await as('hr').post('/settings/departments', { name: 'Team Home' })).body.department;
    const team = (await as('hr').post('/settings/teams', { name: 'Typo Teem', leadId: ids.lead })).body.team;
    expect((await as('hr').patch(`/settings/teams/${team.id}`, { name: 'Good Team', departmentId: dept.id, leadId: '' })).status).toBe(200);
    const row = (await as('hr').get('/settings/teams')).body.teams.find((t) => t.id === team.id);
    expect([row.name, row.department.id, row.lead]).toEqual(['Good Team', dept.id, null]);
    expect((await as('hr').patch(`/settings/teams/${team.id}`, { name: '' })).status).toBe(400);
  });
});

describe('chat: quotes, forwards, pins and live updates', () => {
  let conv;
  const dm = async (who, other) => (await as(who).post('/chat/direct', { userId: ids[other] })).body.conversationId;
  const say = async (who, id, body, extra = {}) => (await as(who).post(`/chat/conversations/${id}/messages`, { body, ...extra })).body.message;

  beforeAll(async () => { conv = await dm('emp', 'lead'); });

  it('quotes a message from the same conversation only', async () => {
    const first = await say('emp', conv, 'Original words');
    const reply = await say('lead', conv, 'I agree', { replyToId: first.id });
    expect(reply.reply).toMatchObject({ id: first.id, body: 'Original words' });
    expect(reply.reply.senderName).toBe(first.senderName);
    const other = await dm('emp', 'hr');
    expect((await as('emp').post(`/chat/conversations/${other}/messages`, { body: 'x', replyToId: first.id })).status).toBe(400);
  });

  it('forwards a copy naming the original sender, only where the person belongs', async () => {
    const source = await say('lead', conv, 'Please pass this on');
    const target = await dm('emp', 'hr');
    expect((await as('emp').post(`/chat/messages/${source.id}/forward`, { conversationIds: [target] })).status).toBe(201);
    const { messages } = (await as('hr').get(`/chat/conversations/${target}/messages`)).body;
    expect(messages[messages.length - 1]).toMatchObject({ body: 'Please pass this on', forwardedFrom: source.senderName });
    const stranger = await dm('hr', 'lead');
    expect((await as('emp').post(`/chat/messages/${source.id}/forward`, { conversationIds: [stranger] })).status).toBe(403);
    expect((await as('hr').post(`/chat/messages/${source.id}/forward`, { conversationIds: [target] })).status).toBe(403);
  });

  it('a pin shows in the list and can be undone', async () => {
    const m = await say('emp', conv, 'Keep this');
    expect((await as('lead').post(`/chat/messages/${m.id}/pin`)).body.message.pinned).toBe(true);
    expect((await as('emp').get(`/chat/conversations/${conv}`)).body.pins.map((p) => p.id)).toContain(m.id);
    await as('emp').post(`/chat/messages/${m.id}/pin`);
    expect((await as('emp').get(`/chat/conversations/${conv}`)).body.pins.map((p) => p.id)).not.toContain(m.id);
  });

  it('live check delivers new messages, edits and notifications once', async () => {
    const first = (await as('lead').get('/live')).body;
    expect(first.messages).toEqual([]);
    const params = (c, at) => `?message=${c.message}&notification=${c.notification}&at=${encodeURIComponent(at)}`;
    const m = await say('emp', conv, 'Live hello');
    await as('emp').post(`/chat/messages/${m.id}/pin`);
    await runAs((await asPlatform(async () => await prisma.user.findUnique({ where: { id: ids.lead } }))).companyId, async () => { await prisma.notification.create({ data: { userId: ids.lead, type: 'test.live', title: 'Live note' } }); });
    const second = (await as('lead').get(`/live${params(first.cursor, first.at)}`)).body;
    expect(second.messages.map((x) => x.id)).toContain(m.id);
    expect(second.messages.find((x) => x.id === m.id).pinned).toBe(true);
    expect(second.notifications.length).toBeGreaterThan(0);
    const third = (await as('lead').get(`/live${params(second.cursor, new Date(Date.now() + 10000).toISOString())}`)).body;
    expect(third.messages).toEqual([]);
    expect(third.notifications).toEqual([]);
    const stale = (await as('hr').get('/live')).body;
    const hrs = (await as('hr').get(`/live${params(stale.cursor, stale.at)}`)).body;
    expect(hrs.messages.map((x) => x.id)).not.toContain(m.id);
  });
});

describe('calls', () => {
  let conv;
  beforeAll(async () => { conv = (await as('emp').post('/chat/direct', { userId: ids.nosup })).body.conversationId; });

  it('rings the other person, connects them, and ends for both', async () => {
    const start = await as('emp').post(`/chat/conversations/${conv}/calls`, { video: false });
    expect(start.status).toBe(201);
    const { call } = start.body;
    const again = await as('emp').post(`/chat/conversations/${conv}/calls`, { video: true });
    expect(again.body.call.id).toBe(call.id);
    await prisma.$executeRawUnsafe('SELECT 1');
    const live = (await as('nosup').get(`/live?at=${encodeURIComponent(new Date().toISOString())}&message=999999999&notification=999999999`)).body;
    expect(live.calls.map((c) => c.id)).toContain(call.id);
    const joined = await as('nosup').post(`/chat/calls/${call.id}/join`);
    expect(joined.body.peers.map((p) => p.id)).toEqual([ids.emp]);
    expect((await as('nosup').post(`/chat/calls/${call.id}/signal`, { toId: ids.emp, kind: 'offer', payload: '{"sdp":"x"}' })).status).toBe(201);
    const seen = (await as('emp').get(`/chat/calls/${call.id}`)).body;
    expect(seen.signals).toHaveLength(1);
    expect(seen.members).toHaveLength(2);
    expect((await as('emp').get(`/chat/calls/${call.id}?after=${seen.signals[0].id}`)).body.signals).toEqual([]);
    expect((await as('hr').get(`/chat/calls/${call.id}`)).status).toBe(403);
    await as('nosup').post(`/chat/calls/${call.id}/leave`);
    expect((await as('emp').get(`/chat/calls/${call.id}`)).body.call.endedAt).toBeTruthy();
    const { messages } = (await as('emp').get(`/chat/conversations/${conv}/messages`)).body;
    expect(messages[messages.length - 1].body).toMatch(/^Call ended/);
    expect(messages.some((m) => m.body?.includes('started a'))).toBe(false);
    const theirs = (await as('nosup').get(`/chat/conversations/${conv}/messages`)).body.messages;
    expect(theirs.find((m) => m.body?.includes('started a'))).toMatchObject({ link: null });
  });

  it('a declined direct call ends as missed', async () => {
    const { call } = (await as('emp').post(`/chat/conversations/${conv}/calls`, {})).body;
    await as('nosup').post(`/chat/calls/${call.id}/decline`);
    const caller = (await as('emp').get(`/chat/conversations/${conv}/messages`)).body.messages;
    expect(caller.some((m) => m.body?.startsWith('Missed call'))).toBe(false);
    const callee = (await as('nosup').get(`/chat/conversations/${conv}/messages`)).body.messages;
    expect(callee[callee.length - 1].body).toMatch(/^Missed call from /);
  });

  it('only accepts real meeting links', async () => {
    const post = (url) => as('emp').post(`/chat/conversations/${conv}/meeting-link`, { url });
    expect((await post('https://meet.google.com/abc-defg-hij')).status).toBe(201);
    expect((await post('https://meet.google.com/new')).status).toBe(400);
    expect((await post('https://evil.example/abc')).status).toBe(400);
  });
});

describe('display names and photos', () => {
  const set = async (who, profile) => as(who).patch('/profile/me', profile);

  it('shows the chosen name everywhere, keeps the full name, and refuses someone else\'s name', async () => {
    await asPlatform(async () => { await prisma.profile.update({ where: { userId: ids.nosup }, data: { firstName: 'Elivi', middleName: 'Elvis', lastName: 'Boka', displayName: null, legalName: 'Elivi Elvis Boka' } }); });
    expect((await set('nosup', { displayName: 'Elvis Boka' })).status).toBe(200);
    const me = (await as('nosup').get('/profile/me')).body.profile;
    expect(me.name).toBe('Elvis Boka');
    expect(me.legalName).toBe('Elivi Elvis Boka');
    expect((await set('nosup', { displayName: 'The Boss' })).status).toBe(400);
    expect((await set('nosup', { displayName: '' })).status).toBe(200);
    expect((await as('nosup').get('/profile/me')).body.profile.name).toBe('Elivi Elvis Boka');
  });

  it('lists photos for the signed-in company only', async () => {
    await asPlatform(async () => { await prisma.profile.update({ where: { userId: ids.emp }, data: { photoFileId: 987654 } }); });
    const { people } = (await as('hr').get('/profile/avatars')).body;
    expect(people.find((p) => p.id === ids.emp).photoFileId).toBe(987654);
    const other = await asPlatform(async () => await prisma.user.findFirst({ where: { companyId: { not: people[0] && (await prisma.user.findUnique({ where: { id: ids.emp } })).companyId }, role: { not: 'SUPER_ADMIN' } } }));
    if (other) expect(people.map((p) => p.id)).not.toContain(other.id);
    await asPlatform(async () => { await prisma.profile.update({ where: { userId: ids.emp }, data: { photoFileId: null } }); });
  });
});

describe('online meetings and invitations', () => {
  const realFetch = global.fetch;
  const company = async () => (await asPlatform(async () => await prisma.user.findUnique({ where: { id: ids.lead } }))).companyId;
  afterEach(() => { global.fetch = realFetch; delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; });

  const googleWorks = (link) => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    global.fetch = jest.fn(async (url) => ({ ok: true, json: async () => (String(url).includes('token') ? { access_token: 't' } : { hangoutLink: link }), text: async () => '' }));
  };

  it('explains what is missing before Meet can be used', async () => {
    const conv = (await as('lead').post('/chat/direct', { userId: ids.emp })).body.conversationId;
    const off = await as('lead').post(`/chat/conversations/${conv}/online-meeting`, { provider: 'GOOGLE' });
    expect([off.status, off.body.code]).toEqual([409, 'NOT_SET_UP']);
    process.env.GOOGLE_CLIENT_ID = 'id';
    const needed = await as('lead').post(`/chat/conversations/${conv}/online-meeting`, { provider: 'GOOGLE' });
    expect(needed.body.code).toBe('CONNECT_NEEDED');
    expect(needed.body.url).toContain('calendar.events');
  });

  it('creates one real Meet link and only the other person sees the notice', async () => {
    const { encrypt } = require('../lib/crypto');
    await runAs(await company(), async () => { await prisma.calendarConnection.create({ data: { userId: ids.lead, provider: 'GOOGLE', refreshEnc: encrypt('r'), canWrite: true } }); });
    googleWorks('https://meet.google.com/abc-defg-hij');
    const conv = (await as('lead').post('/chat/direct', { userId: ids.emp })).body.conversationId;
    const res = await as('lead').post(`/chat/conversations/${conv}/online-meeting`, { provider: 'GOOGLE' });
    expect(res.body.url).toBe('https://meet.google.com/abc-defg-hij');
    const mine = (await as('lead').get(`/chat/conversations/${conv}/messages`)).body.messages;
    expect(mine.some((m) => m.link === res.body.url)).toBe(false);
    const theirs = (await as('emp').get(`/chat/conversations/${conv}/messages`)).body.messages;
    expect(theirs.some((m) => m.link === res.body.url)).toBe(true);
  });

  const invite = (extra) => as('lead').post('/calendar/meetings', { title: 'Planning', date: '2030-03-04', from: '09:00', to: '10:00', attendeeIds: [ids.emp, ids.hr], ...extra });
  const tokenFor = async (eventId, userId) => {
    const email = await asPlatform(async () => { const u = await prisma.user.findUnique({ where: { id: userId } }); return prisma.emailJob.findFirst({ where: { toEmail: u.email, subject: 'Meeting invite: Planning' }, orderBy: { id: 'desc' } }).then((x) => x); });
    return decrypt(email.htmlEnc).match(/meeting-invite\/([a-f0-9]+)\?answer=accept/)[1];
  };

  it('emails each person a link to accept or decline, with the meeting link, without signing in', async () => {
    const res = await invite({ meetingType: 'APP' });
    expect(res.status).toBe(201);
    expect(res.body.meetingUrl).toMatch(/^\/chat\?c=\d+&join=1$/);
    const token = await tokenFor(res.body.id, ids.emp);
    const seen = await request(app).get(`/api/public/meeting-invite/${token}`);
    expect(seen.body).toMatchObject({ title: 'Planning', status: 'PENDING', type: 'In-app call' });
    expect(seen.body.link).toContain('join=1');
    const done = await request(app).post(`/api/public/meeting-invite/${token}`).send({ answer: 'accept' });
    expect(done.body.status).toBe('ACCEPTED');
    await as('hr').post(`/calendar/meetings/${res.body.id}/respond`, { answer: 'decline' });
    const { attendees } = (await as('lead').get(`/calendar/meetings/${res.body.id}`)).body;
    expect(attendees.find((a) => a.id === ids.emp).status).toBe('ACCEPTED');
    expect(attendees.find((a) => a.id === ids.hr).status).toBe('DECLINED');
    expect((await as('lead').get(`/calendar/meetings/${res.body.id}`)).body.organiser).toBeTruthy();
    expect((await request(app).get('/api/public/meeting-invite/not-a-token')).status).toBe(404);
  });

  it('keeps in-app meetings small and needs a connected account for Meet', async () => {
    const people = await asPlatform(async () => (await prisma.user.findMany({ where: { companyId: await company(), active: true, role: { not: 'SUPER_ADMIN' } }, select: { id: true } })).map((u) => u.id));
    if (people.length > 6) expect((await invite({ meetingType: 'APP', attendeeIds: people })).status).toBe(400);
    expect((await invite({ meetingType: 'LINK', meetingUrl: 'not-a-link' })).status).toBe(400);
    googleWorks('https://meet.google.com/xyz-abcd-efg');
    const made = await invite({ meetingType: 'GOOGLE' });
    expect(made.body.meetingUrl).toBe('https://meet.google.com/xyz-abcd-efg');
    expect((await as('emp').post('/calendar/meetings', { title: 'X', date: '2030-03-04', from: '09:00', to: '10:00', attendeeIds: [ids.lead], meetingType: 'GOOGLE' })).body.code).toBe('CONNECT_NEEDED');
  });

  it('cancelling removes the invitations and tells people', async () => {
    const res = await invite({ meetingType: 'NONE', location: 'Boardroom' });
    const token = await tokenFor(res.body.id, ids.emp);
    expect((await as('lead').delete(`/calendar/meetings/${res.body.id}`)).status).toBe(200);
    expect((await request(app).get(`/api/public/meeting-invite/${token}`)).status).toBe(404);
  });
});

describe('call alerts when the app is closed', () => {
  const sub = (n) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'p', auth: 'a' } });
  let conv;
  beforeAll(async () => {
    process.env.VAPID_PUBLIC_KEY = 'public';
    process.env.VAPID_PRIVATE_KEY = 'private';
    conv = (await as('hr').post('/chat/direct', { userId: ids.nosup })).body.conversationId;
    await as('nosup').post('/push/subscribe', sub('nosup'));
  });
  afterAll(() => { delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; });
  beforeEach(() => webpush.sendNotification.mockClear());

  const pushed = () => webpush.sendNotification.mock.calls.map((c) => JSON.parse(c[1]));

  it('rings the other person and stops when the call ends', async () => {
    const { call } = (await as('hr').post(`/chat/conversations/${conv}/calls`, {})).body;
    const [ring] = pushed();
    expect(ring).toMatchObject({ type: 'call', tag: `call-${call.id}`, url: `/chat?c=${conv}&call=${call.id}&answer=1` });
    await as('hr').post(`/chat/calls/${call.id}/leave`);
    expect(pushed().some((p) => p.type === 'call-ended' && p.tag === `call-${call.id}`)).toBe(true);
  });

  it('declines from the notification without a session, only with a real link', async () => {
    const { call } = (await as('hr').post(`/chat/conversations/${conv}/calls`, {})).body;
    const { declineUrl } = pushed()[0];
    const token = declineUrl.split('/call-decline/')[1];
    expect((await request(app).post('/api/public/call-decline/forged')).status).toBe(404);
    expect((await request(app).post(`/api/public/call-decline/${token}`)).status).toBe(200);
    expect((await as('hr').get(`/chat/calls/${call.id}`)).body.call.endedAt).toBeTruthy();
  });

  it('a browser belongs to whoever signed in last, and dead ones are dropped', async () => {
    await as('emp').post('/push/subscribe', sub('shared'));
    await as('hr').post('/push/subscribe', sub('shared'));
    const rows = await asPlatform(async () => await prisma.pushSubscription.findMany({ where: { endpoint: sub('shared').endpoint } }));
    expect(rows.map((r) => r.userId)).toEqual([ids.hr]);
    expect((await as('hr').post('/push/subscribe', { endpoint: 'http://bad', keys: {} })).status).toBe(400);
    webpush.sendNotification.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));
    const { call } = (await as('hr').post(`/chat/conversations/${conv}/calls`, {})).body;
    expect(await asPlatform(async () => await prisma.pushSubscription.count({ where: { userId: ids.nosup } }))).toBe(0);
    await as('hr').post(`/chat/calls/${call.id}/leave`);
  });

  it('only offers Google as a calendar connection', async () => {
    expect((await as('hr').get('/calendar/connections')).body.connections.map((c) => c.provider)).toEqual(['GOOGLE']);
  });
});
