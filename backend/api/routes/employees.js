const express = require('express');
const { Prisma } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = require('../../lib/prisma');
const { authenticate, requirePerm } = require('../middleware/auth');
const { HttpError, h, required, intParam, isDate } = require('../middleware/validation');
const { tempPassword } = require('../../lib/crypto');
const { audit } = require('../../lib/audit');
const { getSettings } = require('../../lib/settings');
const { toDbDate, fromDbDate, today, yearOf } = require('../../lib/time');
const { splitName } = require('../../lib/names');
const { welcomeHtml, getTemplate, queueEmail, companyUrl, brand, fill } = require('../../lib/email');
const { ALL, SCOPE_TO_LEVEL, permissionsOf, isOwner, withOverrides, clearPermissionCache } = require('../../lib/permissions');
const { saveHrProfile } = require('./profile');
const { syncUserChannels, presenceFor } = require('../../lib/chat');
const { formatInTimeZone } = require('date-fns-tz');
const jwt = require('jsonwebtoken');

const router = express.Router();
router.use(authenticate);

const TEMP_HOURS = 72;

const listInclude = {
  accessRole: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
  manager: { select: { id: true, name: true } },
  schedule: { select: { id: true, name: true } },
};

function view(u) {
  const inviteExpired = u.mustChangePassword && u.tempPasswordExpiry && u.tempPasswordExpiry < new Date();
  return {
    id: u.id, employeeNo: u.employeeNo, name: u.name, email: u.email, role: u.role, accessRole: u.accessRole, jobTitle: u.jobTitle, active: u.active,
    department: u.department, team: u.team, manager: u.manager, schedule: u.schedule,
    startDate: fromDbDate(u.startDate), salaryBand: u.salaryBand, inviteStatus: inviteExpired ? 'EXPIRED' : u.inviteStatus,
    invitedAt: u.invitedAt, activatedAt: u.activatedAt, lastLoginAt: u.lastLoginAt, twoFactorOn: u.twoFactorOn,
  };
}

// USR-02, ONB-01/02: a fresh temporary password, hashed; the plain value only ever lives in the encrypted email job.
async function sendInvite(user, actorName) {
  const password = tempPassword();
  const expiry = new Date(Date.now() + TEMP_HOURS * 3600000);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true, tempPasswordExpiry: expiry, inviteStatus: 'SENT', invitedAt: new Date(), failedLogins: 0, lockedUntil: null },
  });
  const full = await prisma.user.findUnique({ where: { id: user.id }, include: { manager: true } });
  const { timezone } = await getSettings();
  const template = await getTemplate('welcome');
  const token = jwt.sign({ userId: user.id, purpose: 'invite' }, process.env.JWT_SECRET, { expiresIn: `${TEMP_HOURS}h` });
  const job = await queueEmail({
    to: user.email, name: user.name, subject: fill(template.subject, { companyName: (await brand()).companyName }), kind: 'welcome', userId: user.id,
    html: await welcomeHtml({
      signInUrl: companyUrl(await brand(), `/login?invite=${token}`), design: template.design, name: user.name, email: user.email, tempPassword: password, intro: template.body, hrName: actorName,
      expires: formatInTimeZone(expiry, timezone, 'EEE d MMM yyyy, HH:mm'),
      startDate: formatInTimeZone(full.startDate, 'UTC', 'EEE d MMM yyyy'),
      managerName: full.manager?.name,
    }),
  });
  return job.sent !== false;
}

async function nextEmployeeNo() {
  const rows = await prisma.user.findMany({ where: { employeeNo: { startsWith: 'EMP-' } }, select: { employeeNo: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.employeeNo.slice(4)) || 0), 0);
  return `EMP-${String(max + 1).padStart(4, '0')}`;
}

// The role a person gets: a company role by id or name. A scope name also works, for CSV imports.
async function resolveRole(body) {
  if (body.roleId) {
    const role = await prisma.accessRole.findUnique({ where: { id: Number(body.roleId) } });
    if (!role) throw new HttpError(400, 'Pick a role');
    return role;
  }
  const wanted = String(body.role || 'Employee').trim();
  const roles = await prisma.accessRole.findMany();
  const level = Object.entries(SCOPE_TO_LEVEL).find(([, l]) => l === wanted.toUpperCase())?.[0];
  const role = roles.find((r) => r.name.toLowerCase() === wanted.toLowerCase()) || roles.find((r) => r.scope === level && (level !== 'COMPANY' || r.isSystem));
  if (!role) throw new HttpError(400, `There is no role called ${wanted}`);
  return role;
}

// Nobody gives someone access they don't hold. Screens don't count: admins can hire staff who log timesheets without logging any themselves.
// Only the company admin makes someone HR (or another company-wide role).
async function assertCanGrant(actor, role) {
  if (await isOwner(actor)) return;
  if (role.scope === 'COMPANY') throw new HttpError(403, 'Only the company admin can give someone a company-wide role like HR');
  const mine = await permissionsOf(actor);
  if (role.permissions.some((k) => !k.startsWith('module.') && !mine.includes(k))) throw new HttpError(403, 'You cannot give someone access you do not have');
}

// HR looks after managers and employees. HR and admin accounts are the company admin's to change.
async function assertCanManage(actor, target) {
  if (target.role === 'SUPER_ADMIN') throw new HttpError(403, 'This account cannot be changed here');
  if (actor.id === target.id || (await isOwner(actor))) return;
  const role = target.accessRoleId ? await prisma.accessRole.findUnique({ where: { id: target.accessRoleId } }) : null;
  if (role?.scope === 'COMPANY') throw new HttpError(403, 'Only the company admin can change HR and admin accounts');
}

const canManage = (actor, target) => assertCanManage(actor, target).then(() => true, () => false);

async function assertSeat() {
  const { seats } = await getSettings();
  const used = await prisma.user.count({ where: { active: true } });
  if (used >= seats) throw new HttpError(409, `All ${seats} seats are in use. Ask the Super Admin to add seats.`);
}

async function validateRefs(body) {
  if (body.managerId) {
    const m = await prisma.user.findUnique({ where: { id: Number(body.managerId) } });
    if (!m?.active) throw new HttpError(400, 'Manager must be an active person in this company');
  }
}

async function createUser(body, req) {
  if (!body.name && body.firstName) body.name = [body.firstName, body.lastName].filter(Boolean).join(' ');
  required(body, ['name', 'email', 'startDate']);
  const email = String(body.email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address');
  if (!isDate(body.startDate)) throw new HttpError(400, 'Start date must be yyyy-mm-dd');
  const accessRole = await resolveRole(body);
  await assertCanGrant(req.user, accessRole);
  await assertSeat();
  await validateRefs(body);
  if (await prisma.user.findFirst({ where: { email } })) throw new HttpError(409, 'That email already has an account');
  const employeeNo = body.employeeNo || (await nextEmployeeNo());
  if (await prisma.user.findFirst({ where: { employeeNo } })) throw new HttpError(409, 'That employee number is already used');

  const user = await prisma.user.create({
    data: {
      name: body.name.trim(), email, employeeNo, role: SCOPE_TO_LEVEL[accessRole.scope], accessRoleId: accessRole.id, jobTitle: body.jobTitle, startDate: toDbDate(body.startDate),
      departmentId: body.departmentId ? Number(body.departmentId) : null, teamId: body.teamId ? Number(body.teamId) : null, managerId: body.managerId ? Number(body.managerId) : null,
      scheduleId: body.scheduleId ? Number(body.scheduleId) : null,
      salaryBand: body.salaryBand, profile: { create: { legalName: body.name.trim(), ...splitName(body.name) } },
    },
  });
  if (body.profile) await saveHrProfile(user.id, body.profile);

  // Initial allocations: each type's default days for the current cycle, overridable per type.
  const { timezone } = await getSettings();
  const year = yearOf(today(timezone));
  const types = await prisma.leaveType.findMany({ where: { active: true, requiresAllocation: true } });
  const overrides = body.allocations || {};
  const rows = types.map((t) => ({ type: t, days: overrides[t.id] !== undefined ? Number(overrides[t.id]) : t.defaultDays })).filter((r) => r.days > 0);
  if (rows.length) {
    await prisma.leaveAllocation.createMany({
      data: rows.map((r) => ({ userId: user.id, leaveTypeId: r.type.id, days: r.days, kind: 'GRANT', periodStart: toDbDate(`${year}-01-01`), periodEnd: toDbDate(`${year}-12-31`), note: `${year} allocation`, createdById: req.user.id })),
    });
  }
  await syncUserChannels(user.id);
  await audit(req, { entity: 'User', entityId: user.id, action: 'user.created', after: { name: user.name, email, role: user.role, departmentId: user.departmentId } });
  await sendInvite(user, req.user.name);
  return user;
}

router.get('/options', h(async (req, res) => {
  const [departments, teams, schedules, leaders, leaveTypes, roles] = await Promise.all([
    prisma.department.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, managerId: true } }),
    prisma.team.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, departmentId: true } }),
    prisma.workSchedule.findMany({ where: { active: true }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, role: true, departmentId: true } }),
    prisma.leaveType.findMany({ where: { active: true, requiresAllocation: true }, select: { id: true, name: true, defaultDays: true, accrualPerMonth: true } }),
    prisma.accessRole.findMany({ orderBy: [{ isSystem: 'desc' }, { name: 'asc' }], select: { id: true, name: true, scope: true } }),
  ]);
  const owner = await isOwner(req.user);
  res.json({
    departments, teams, schedules, leaveTypes, roles: owner ? roles : roles.filter((r) => r.scope !== 'COMPANY'),
    managers: leaders,
    nextEmployeeNo: await nextEmployeeNo(),
  });
}));

router.get('/', requirePerm('users.manage'), h(async (req, res) => {
  const { q, departmentId, roleId, status = 'active' } = req.query;
  const where = {
    accessRoleId: roleId ? Number(roleId) : undefined,
    active: status === 'all' ? undefined : status === 'active',
    departmentId: departmentId ? Number(departmentId) : undefined,
  };
  if (q) where.OR = [{ name: { contains: q } }, { email: { contains: q } }, { employeeNo: { contains: q } }];
  const users = await prisma.user.findMany({ where, include: listInclude, orderBy: { name: 'asc' } });
  res.json({ employees: users.map(view) });
}));

router.get('/:id', requirePerm('users.manage'), h(async (req, res) => {
  const id = intParam(req.params.id);
  const user = await prisma.user.findUnique({ where: { id }, include: listInclude });
  if (!user) throw new HttpError(404, 'Employee not found');
  const history = await prisma.userHistory.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 50 });
  const actors = await prisma.user.findMany({ where: { id: { in: history.map((x) => x.actorId) } }, select: { id: true, name: true } });
  const names = new Map(actors.map((a) => [a.id, a.name]));
  const changes = await Promise.all(history.map(async (x) => ({
    ...x, actorName: names.get(x.actorId), oldValue: await displayValue(x.field, x.oldValue), newValue: await displayValue(x.field, x.newValue),
  })));
  const presence = await presenceFor([{ ...user }]);
  const role = user.accessRoleId ? await prisma.accessRole.findUnique({ where: { id: user.accessRoleId } }) : null;
  const manageable = await canManage(req.user, user);
  res.json({
    employee: view(user), presence: presence.get(id), manageable,
    // Individual access: the owner role and your own account can't be tweaked.
    access: role && !role.isSystem && manageable && id !== req.user.id ? { rolePermissions: role.permissions, overrides: user.permissionOverrides || {}, effective: withOverrides(role, user.permissionOverrides) } : null, history: changes });
}));

router.post('/', requirePerm('users.manage'), h(async (req, res) => {
  const user = await createUser(req.body, req);
  res.status(201).json({ employee: view(await prisma.user.findUnique({ where: { id: user.id }, include: listInclude })) });
}));

// USR-07: expects CSV text with a header row. Each row stands alone, so one bad line doesn't stop the rest.
router.post('/import', requirePerm('users.manage'), h(async (req, res) => {
  required(req.body, ['csv']);
  const lines = String(req.body.csv).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new HttpError(400, 'The file needs a header row and at least one employee');
  const header = lines[0].split(',').map((c) => c.trim().toLowerCase());
  for (const col of ['name', 'email', 'role', 'start_date']) if (!header.includes(col)) throw new HttpError(400, `Missing column: ${col}`);
  const [departments, schedules, leaders] = await Promise.all([
    prisma.department.findMany(), prisma.workSchedule.findMany(), prisma.user.findMany({ where: { active: true } }),
  ]);
  const byName = (rows, name) => rows.find((r) => r.name.toLowerCase() === String(name || '').toLowerCase())?.id;
  const results = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(',').map((c) => c.trim());
    const row = Object.fromEntries(header.map((k, idx) => [k, cols[idx]]));
    try {
      const user = await createUser({
        name: row.name, email: row.email, role: row.role || 'Employee', startDate: row.start_date, jobTitle: row.position || row.job_title,
        employeeNo: row.employee_no, departmentId: byName(departments, row.department), scheduleId: byName(schedules, row.schedule),
        managerId: byName(leaders, row.manager),
      }, req);
      results.push({ line: i + 1, ok: true, email: user.email });
    } catch (err) {
      results.push({ line: i + 1, ok: false, email: row.email, error: err.message });
    }
  }
  res.json({ results, created: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
}));

const TRACKED = { accessRoleId: 'Role', managerId: 'Manager', departmentId: 'Department', teamId: 'Team', jobTitle: 'Position' };
const NAMED_BY = { Role: 'accessRole', Manager: 'user', Department: 'department', Team: 'team' };

// History stores ids for these fields; people read names.
async function displayValue(field, value) {
  if (value === null || value === undefined || !NAMED_BY[field]) return value ?? null;
  const row = await prisma[NAMED_BY[field]].findUnique({ where: { id: Number(value) }, select: { name: true } });
  return row?.name ?? String(value);
}

router.patch('/:id', requirePerm('users.assign'), h(async (req, res) => {
  const id = intParam(req.params.id);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new HttpError(404, 'Employee not found');
  await assertCanManage(req.user, user);
  const b = req.body;
  let accessRole = null;
  if (b.roleId || b.role) {
    accessRole = await resolveRole(b);
    await assertCanGrant(req.user, accessRole);
    if (id === req.user.id && accessRole.id !== user.accessRoleId) throw new HttpError(403, 'You cannot change your own role');
  }
  await validateRefs(b);
  if (b.managerId && Number(b.managerId) === id) throw new HttpError(400, 'Someone cannot manage themselves');
  if (b.startDate && !isDate(b.startDate)) throw new HttpError(400, 'Start date must be yyyy-mm-dd');

  const nullable = (v) => (v === undefined ? undefined : v === null || v === '' ? null : Number(v));
  const data = {
    name: b.name, jobTitle: b.jobTitle, salaryBand: b.salaryBand, accessRoleId: accessRole?.id, role: accessRole ? SCOPE_TO_LEVEL[accessRole.scope] : undefined,
    departmentId: nullable(b.departmentId), teamId: nullable(b.teamId), managerId: nullable(b.managerId), scheduleId: nullable(b.scheduleId),
    startDate: b.startDate ? toDbDate(b.startDate) : undefined,
  };
  const updated = await prisma.user.update({ where: { id }, data, include: listInclude });
  if (b.profile) await saveHrProfile(id, b.profile);
  const changes = Object.keys(TRACKED).filter((k) => data[k] !== undefined && data[k] !== user[k]);
  if (changes.length) {
    await prisma.userHistory.createMany({
      data: changes.map((field) => ({ userId: id, actorId: req.user.id, field: TRACKED[field], oldValue: user[field] === null ? null : String(user[field]), newValue: data[field] === null ? null : String(data[field]) })),
    });
  }
  if (data.departmentId !== undefined && data.departmentId !== user.departmentId) await syncUserChannels(id);
  const labelled = async (source) => Object.fromEntries(await Promise.all(changes.map(async (k) => [TRACKED[k], await displayValue(TRACKED[k], source[k])])));
  await audit(req, { entity: 'User', entityId: id, action: 'user.updated', before: await labelled(user), after: await labelled(data) });
  res.json({ employee: view(updated) });
}));

router.post('/:id/archive', requirePerm('users.manage'), h(async (req, res) => {
  const id = intParam(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'You cannot archive your own account');
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new HttpError(404, 'Employee not found');
  await assertCanManage(req.user, user);
  const owners = await prisma.user.count({ where: { active: true, accessRole: { isSystem: true } } });
  if (owners === 1 && (await prisma.accessRole.findUnique({ where: { id: user.accessRoleId ?? 0 } }))?.isSystem) throw new HttpError(409, 'A company needs at least one admin');
  await prisma.user.update({ where: { id }, data: { active: false, archivedAt: new Date() } });
  await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  await syncUserChannels(id);
  await audit(req, { entity: 'User', entityId: id, action: 'user.archived' });
  res.json({ ok: true });
}));

router.post('/:id/restore', requirePerm('users.manage'), h(async (req, res) => {
  const id = intParam(req.params.id);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new HttpError(404, 'Employee not found');
  await assertCanManage(req.user, user);
  await assertSeat();
  await prisma.user.update({ where: { id }, data: { active: true, archivedAt: null } });
  await syncUserChannels(id);
  await audit(req, { entity: 'User', entityId: id, action: 'user.restored' });
  res.json({ ok: true });
}));

// ONB-05: a resend voids the old temporary password by replacing its hash.
router.post('/:id/resend-invite', requirePerm('users.manage'), h(async (req, res) => {
  const id = intParam(req.params.id);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new HttpError(404, 'Employee not found');
  await assertCanManage(req.user, user);
  if (user.inviteStatus === 'ACTIVATED') throw new HttpError(409, 'This person has already activated their account');
  if (req.body.email) {
    const email = String(req.body.email).trim().toLowerCase();
    if (await prisma.user.findFirst({ where: { email, id: { not: id } } })) throw new HttpError(409, 'That email already has an account');
    await prisma.user.update({ where: { id }, data: { email } });
    user.email = email;
  }
  await sendInvite(user, req.user.name);
  await audit(req, { entity: 'User', entityId: id, action: 'invite.resent' });
  res.json({ ok: true });
}));

// Switch screens or actions on or off for one person, on top of their role (e.g. an unpaid intern without payslips).
router.put('/:id/access', requirePerm('users.assign'), h(async (req, res) => {
  const id = intParam(req.params.id);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new HttpError(404, 'Employee not found');
  if (id === req.user.id) throw new HttpError(403, 'You cannot change your own access');
  await assertCanManage(req.user, user);
  const role = user.accessRoleId ? await prisma.accessRole.findUnique({ where: { id: user.accessRoleId } }) : null;
  if (!role || role.isSystem) throw new HttpError(409, "The company admin's access cannot be changed");
  const overrides = {};
  for (const [key, on] of Object.entries(req.body.overrides || {})) {
    if (!ALL.includes(key) || typeof on !== 'boolean' || role.permissions.includes(key) === on) continue;
    overrides[key] = on;
  }
  if (!(await isOwner(req.user))) {
    const mine = await permissionsOf(req.user);
    if (Object.entries(overrides).some(([k, on]) => on && !k.startsWith('module.') && !mine.includes(k))) throw new HttpError(403, 'You cannot give someone access you do not have');
  }
  const value = Object.keys(overrides).length ? overrides : null;
  await prisma.user.update({ where: { id }, data: { permissionOverrides: value ?? Prisma.DbNull } });
  clearPermissionCache();
  await audit(req, { entity: 'User', entityId: id, action: 'user.access_changed', before: user.permissionOverrides, after: value });
  res.json({ overrides: value || {}, effective: withOverrides(role, value) });
}));

module.exports = router;
module.exports.sendInvite = sendInvite;
