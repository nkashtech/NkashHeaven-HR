const express = require('express');
const prisma = require('../../lib/prisma');
const { authenticate, requirePerm } = require('../middleware/auth');
const { HttpError, h, required, intParam, dateParam } = require('../middleware/validation');
const { getSettings, updateSettings, effectiveLockDate } = require('../../lib/settings');
const { audit } = require('../../lib/audit');
const { TEMPLATES, getTemplate, welcomeHtml, resetHtml, payslipHtml, notificationHtml } = require('../../lib/email');
const { ensureDepartmentChannel, renameDepartmentChannel } = require('../../lib/chat');
const { toDbDate, fromDbDate } = require('../../lib/time');
const { formatInTimeZone } = require('date-fns-tz');

const router = express.Router();
router.use(authenticate);

// Personal preferences (SET-01)
router.put('/preferences', h(async (req, res) => {
  const b = req.body;
  const data = {
    theme: ['light', 'dark', 'system'].includes(b.theme) ? b.theme : undefined, language: b.language, timezone: b.timezone, dateFormat: b.dateFormat,
    showBirthday: b.showBirthday, showPhone: b.showPhone, doNotDisturb: b.doNotDisturb, chatDigest: b.chatDigest,
  };
  await prisma.user.update({ where: { id: req.user.id }, data });
  res.json({ ok: true });
}));

// HR settings (SET-02)
router.get('/company', requirePerm('org.configure'), h(async (req, res) => {
  const settings = await getSettings();
  res.json({
    companyName: settings.companyName, timezone: settings.timezone, attendance: settings.attendance, timesheets: settings.timesheets,
    lockDate: effectiveLockDate(settings, settings.timezone),
  });
}));

router.put('/company', requirePerm('org.configure'), h(async (req, res) => {
  const { companyName, timezone, attendance, timesheets } = req.body;
  if (companyName || timezone) await prisma.company.update({ where: { id: req.user.companyId }, data: { name: companyName, timezone } });
  if (attendance) {
    if (attendance.lockDate) dateParam(attendance.lockDate, 'lockDate');
    await updateSettings('attendance', attendance);
  }
  if (timesheets) await updateSettings('timesheets', timesheets);
  await audit(req, { entity: 'Settings', action: 'settings.company_updated', after: { attendance, timesheets, companyName, timezone } });
  res.json({ ok: true });
}));

// Company branding: logos, colour and the footer used on emails and payslips.
router.get('/branding', requirePerm('branding.manage'), h(async (req, res) => {
  const s = await getSettings();
  res.json({ branding: s.branding, companyName: s.companyName, slug: s.slug });
}));

// The employee card design
router.get('/card-design', requirePerm('branding.manage'), h(async (req, res) => res.json({ card: (await getSettings()).card })));

router.put('/card-design', requirePerm('branding.manage'), h(async (req, res) => {
  const b = req.body;
  for (const k of ['widthMm', 'heightMm', 'radiusMm', 'qrSizeMm']) if (b[k] !== undefined) b[k] = Number(b[k]);
  if (b.widthMm < 40 || b.widthMm > 210 || b.heightMm < 30 || b.heightMm > 297) throw new HttpError(400, 'Card size must be between 40×30 mm and 210×297 mm');
  await updateSettings('card', b);
  await audit(req, { entity: 'Settings', action: 'settings.card_updated', after: b });
  res.json({ ok: true });
}));

// Security rules for this company
router.get('/security', requirePerm('org.configure'), h(async (req, res) => {
  const s = await getSettings();
  res.json({ security: s.security, chat: s.chat });
}));

router.put('/security', requirePerm('org.configure'), h(async (req, res) => {
  const { security, chat } = req.body;
  if (security) {
    if (security.minPasswordLength !== undefined && Number(security.minPasswordLength) < 8) throw new HttpError(400, 'Passwords must stay at least 8 characters');
    await updateSettings('security', security);
  }
  if (chat) await updateSettings('chat', chat);
  await audit(req, { entity: 'Settings', action: 'settings.security_updated', after: req.body });
  res.json({ ok: true });
}));

// Approval workflows the company builds for itself
const WORKFLOW_KINDS = ['MANAGER', 'HR', 'ROLE', 'USER'];
function workflowData(b) {
  if (!['LEAVE', 'TIMESHEET'].includes(b.appliesTo)) throw new HttpError(400, 'A workflow applies to leave or timesheets');
  if (!Array.isArray(b.steps) || !b.steps.length) throw new HttpError(400, 'Add at least one step');
  for (const s of b.steps) {
    if (!WORKFLOW_KINDS.includes(s.kind) || (s.kind === 'ROLE' && !s.roleId) || (s.kind === 'USER' && !s.userId)) throw new HttpError(400, 'Each step needs an approver');
  }
  return { name: b.name, appliesTo: b.appliesTo, steps: b.steps };
}

router.get('/workflows', h(async (req, res) => {
  const { timesheets } = await getSettings();
  res.json({ workflows: await prisma.workflow.findMany({ where: { active: true }, orderBy: { name: 'asc' } }), timesheetWorkflowId: timesheets.workflowId });
}));

router.post('/workflows', requirePerm('org.configure'), h(async (req, res) => {
  required(req.body, ['name']);
  const workflow = await prisma.workflow.create({ data: workflowData(req.body) });
  await audit(req, { entity: 'Workflow', entityId: workflow.id, action: 'workflow.created', after: workflow });
  res.status(201).json({ workflow });
}));

router.patch('/workflows/:id', requirePerm('org.configure'), h(async (req, res) => {
  const id = intParam(req.params.id);
  const workflow = await prisma.workflow.update({ where: { id }, data: workflowData(req.body) });
  await audit(req, { entity: 'Workflow', entityId: id, action: 'workflow.updated', after: workflow });
  res.json({ workflow });
}));

router.delete('/workflows/:id', requirePerm('org.configure'), h(async (req, res) => {
  const id = intParam(req.params.id);
  await prisma.leaveType.updateMany({ where: { workflowId: id }, data: { workflowId: null } });
  await prisma.workflow.update({ where: { id }, data: { active: false } });
  res.json({ ok: true });
}));

router.put('/branding', requirePerm('branding.manage'), h(async (req, res) => {
  const { companyName, logoFileId, payslipLogoFileId, primaryColor, address, registrationNo, emailFooter } = req.body;
  if (primaryColor && !/^#[0-9a-fA-F]{6}$/.test(primaryColor)) throw new HttpError(400, 'Colour must look like #B34D22');
  if (companyName !== undefined && !String(companyName).trim()) throw new HttpError(400, 'Enter the company name');
  if (companyName) await prisma.company.update({ where: { id: req.user.companyId }, data: { name: String(companyName).trim() } });
  const { branding: before, card } = await getSettings();
  await updateSettings('branding', { logoFileId, payslipLogoFileId, primaryColor, address, registrationNo, emailFooter });
  // The employee card follows the company logo unless it was given a logo of its own.
  const same = (x, y) => String(x ?? '') === String(y ?? '');
  if (logoFileId !== undefined && !same(logoFileId, before.logoFileId) && (!card.logoFileId || same(card.logoFileId, before.logoFileId))) await updateSettings('card', { logoFileId: logoFileId || null });
  await audit(req, { entity: 'Settings', action: 'settings.branding_updated', after: req.body });
  res.json({ ok: true });
}));

// Previews use this company's newest hire and their latest approved leave, so they show real names and dates.
async function preview(key, template, userName) {
  const { timezone } = await getSettings();
  const person = await prisma.user.findFirst({ where: { active: true, role: { not: 'SUPER_ADMIN' } }, orderBy: { startDate: 'desc' }, include: { manager: { select: { name: true } } } });
  const name = person?.name || userName;
  if (key === 'welcome') {
    return welcomeHtml({
      name, email: person?.email || '', tempPassword: '[TEMP-PASSWORD]', expires: formatInTimeZone(new Date(Date.now() + 72 * 3600000), timezone, 'EEE d MMM yyyy, HH:mm'),
      startDate: person ? formatInTimeZone(person.startDate, 'UTC', 'EEE d MMM yyyy') : null, managerName: person?.manager?.name, hrName: userName, intro: template.body, design: template.design,
    });
  }
  if (key === 'password_reset') return resetHtml({ name, link: '#' });
  if (key === 'notification') {
    const leave = await prisma.leaveRequest.findFirst({ where: { state: 'APPROVED' }, orderBy: { finalAt: 'desc' }, include: { leaveType: { select: { name: true } } } });
    const body = leave ? `${leave.leaveType.name}: ${formatInTimeZone(leave.dateFrom, 'UTC', 'd MMM')} to ${formatInTimeZone(leave.dateTo, 'UTC', 'd MMM')}` : 'Your request was approved.';
    return notificationHtml({ title: 'Your leave was approved', body, link: '/leave' });
  }
  return (await payslipHtml({ name, period: formatInTimeZone(new Date(), timezone, 'MMMM yyyy') })).html;
}

router.get('/email-templates', requirePerm('branding.manage'), h(async (req, res) => {
  const templates = await Promise.all(Object.keys(TEMPLATES).map(async (key) => {
    const t = await getTemplate(key);
    return { key, label: t.label, placeholders: t.placeholders, subject: t.subject, body: t.body, design: t.design, defaults: { subject: TEMPLATES[key].subject, body: TEMPLATES[key].body, design: {} }, preview: await preview(key, t, req.user.name) };
  }));
  res.json({ templates });
}));

router.put('/email-templates/:key', requirePerm('branding.manage'), h(async (req, res) => {
  const { key } = req.params;
  if (!TEMPLATES[key]) throw new HttpError(404, 'Unknown template');
  required(req.body, ['subject']);
  if (key !== 'notification') required(req.body, ['body']);
  const data = { subject: req.body.subject, body: req.body.body || '', design: req.body.design || {} };
  const row = await prisma.emailTemplate.upsert({ where: { companyId_key: { companyId: req.user.companyId, key } }, create: { key, ...data }, update: data });
  await audit(req, { entity: 'EmailTemplate', entityId: row.id, action: 'email_template.updated', after: { key } });
  res.json({ ok: true });
}));

// Teams inside departments
router.get('/teams', h(async (req, res) => {
  const rows = await prisma.team.findMany({ where: { active: true }, orderBy: { name: 'asc' }, include: { department: { select: { id: true, name: true } }, lead: { select: { id: true, name: true } }, _count: { select: { members: { where: { active: true } } } } } });
  res.json({ teams: rows.map((t) => ({ id: t.id, name: t.name, department: t.department, lead: t.lead, people: t._count.members })) });
}));

router.post('/teams', requirePerm('org.configure'), h(async (req, res) => {
  required(req.body, ['name']);
  const team = await prisma.team.create({ data: { name: req.body.name, departmentId: req.body.departmentId ? Number(req.body.departmentId) : null, leadId: req.body.leadId ? Number(req.body.leadId) : null } });
  await audit(req, { entity: 'Team', entityId: team.id, action: 'team.created', after: team });
  res.status(201).json({ team });
}));

const newName = (name) => {
  if (name === undefined) return undefined;
  const trimmed = String(name).trim();
  if (!trimmed) throw new HttpError(400, 'Enter a name');
  return trimmed;
};

router.patch('/teams/:id', requirePerm('org.configure'), h(async (req, res) => {
  const id = intParam(req.params.id);
  const nullable = (v) => (v === undefined ? undefined : v ? Number(v) : null);
  const team = await prisma.team.update({ where: { id }, data: { name: newName(req.body.name), departmentId: nullable(req.body.departmentId), leadId: nullable(req.body.leadId), active: req.body.active } });
  await audit(req, { entity: 'Team', entityId: id, action: 'team.updated', after: team });
  res.json({ team });
}));

// Departments
router.get('/departments', h(async (req, res) => {
  const rows = await prisma.department.findMany({ where: { active: true }, orderBy: { name: 'asc' }, include: { manager: { select: { id: true, name: true } }, _count: { select: { users: { where: { active: true } } } } } });
  res.json({ departments: rows.map((d) => ({ id: d.id, name: d.name, manager: d.manager, people: d._count.users })) });
}));

router.post('/departments', requirePerm('org.configure'), h(async (req, res) => {
  required(req.body, ['name']);
  const department = await prisma.department.create({ data: { name: req.body.name, managerId: req.body.managerId ? Number(req.body.managerId) : null } });
  await ensureDepartmentChannel(department);
  await audit(req, { entity: 'Department', entityId: department.id, action: 'department.created', after: department });
  res.status(201).json({ department });
}));

router.patch('/departments/:id', requirePerm('org.configure'), h(async (req, res) => {
  const id = intParam(req.params.id);
  const before = await prisma.department.findUnique({ where: { id } });
  const department = await prisma.department.update({
    where: { id }, data: { name: newName(req.body.name), managerId: req.body.managerId === undefined ? undefined : req.body.managerId ? Number(req.body.managerId) : null, active: req.body.active },
  });
  if (department.name !== before.name) await renameDepartmentChannel(department);
  await audit(req, { entity: 'Department', entityId: id, action: 'department.updated', before, after: department });
  res.json({ department });
}));

// Work schedules
router.get('/schedules', h(async (req, res) => {
  res.json({ schedules: await prisma.workSchedule.findMany({ where: { active: true }, include: { _count: { select: { users: { where: { active: true } } } } } }) });
}));

const scheduleData = (b) => {
  const days = {};
  for (const [day, shift] of Object.entries(b.days || {})) {
    if (!shift?.start || !shift?.end) continue;
    if (shift.end <= shift.start) throw new HttpError(400, 'A shift must end after it starts');
    days[day] = { start: shift.start, end: shift.end };
  }
  return { name: b.name, days, breakMinutes: Number(b.breakMinutes ?? 60), hoursPerDay: Number(b.hoursPerDay ?? 8) };
};

router.post('/schedules', requirePerm('org.configure'), h(async (req, res) => {
  required(req.body, ['name', 'days']);
  const schedule = await prisma.workSchedule.create({ data: scheduleData(req.body) });
  await audit(req, { entity: 'WorkSchedule', entityId: schedule.id, action: 'schedule.created', after: schedule });
  res.status(201).json({ schedule });
}));

router.patch('/schedules/:id', requirePerm('org.configure'), h(async (req, res) => {
  const id = intParam(req.params.id);
  const before = await prisma.workSchedule.findUnique({ where: { id } });
  const schedule = await prisma.workSchedule.update({ where: { id }, data: { ...scheduleData({ ...before, ...req.body }), active: req.body.active } });
  await audit(req, { entity: 'WorkSchedule', entityId: id, action: 'schedule.updated', before, after: schedule });
  res.json({ schedule });
}));

// Public holidays
router.get('/holidays', h(async (req, res) => {
  const rows = await prisma.publicHoliday.findMany({ orderBy: { date: 'asc' } });
  res.json({ holidays: rows.map((x) => ({ id: x.id, date: fromDbDate(x.date), name: x.name, kind: x.kind })) });
}));

router.post('/holidays', requirePerm('org.configure'), h(async (req, res) => {
  required(req.body, ['date', 'name']);
  const row = await prisma.publicHoliday.create({ data: { date: toDbDate(dateParam(req.body.date)), name: req.body.name, kind: req.body.kind === 'OFFICE' ? 'OFFICE' : 'PUBLIC' } });
  await audit(req, { entity: 'PublicHoliday', entityId: row.id, action: 'holiday.created', after: req.body });
  res.status(201).json({ holiday: { id: row.id, date: req.body.date, name: row.name, kind: row.kind } });
}));

router.delete('/holidays/:id', requirePerm('org.configure'), h(async (req, res) => {
  const id = intParam(req.params.id);
  await prisma.publicHoliday.delete({ where: { id } });
  await audit(req, { entity: 'PublicHoliday', entityId: id, action: 'holiday.deleted' });
  res.json({ ok: true });
}));

router.get('/audit', requirePerm('audit.view'), h(async (req, res) => {
  const { actor, entity, from, to, page = 1 } = req.query;
  const where = {
    entity: entity || undefined,
    actorName: actor ? { contains: actor } : undefined,
    at: { gte: from ? toDbDate(dateParam(from, 'from')) : undefined, lte: to ? new Date(`${dateParam(to, 'to')}T23:59:59Z`) : undefined },
  };
  const take = 50;
  const [logs, total, entities] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { at: 'desc' }, take, skip: (Number(page) - 1) * take }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ distinct: ['entity'], select: { entity: true } }),
  ]);
  res.json({ logs, total, pages: Math.ceil(total / take), entities: entities.map((e) => e.entity).sort() });
}));

module.exports = { router };
