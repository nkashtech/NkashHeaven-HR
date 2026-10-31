const express = require('express');
const PDFDocument = require('pdfkit');
const prisma = require('../../lib/prisma');
const { authenticate, requirePerm } = require('../middleware/auth');
const { HttpError, h, required, intParam, dateParam } = require('../middleware/validation');
const { getSettings } = require('../../lib/settings');
const { audit } = require('../../lib/audit');
const { namedInWorkflow } = require('../../lib/permissions');
const { isAdmin, teamIds, canAccessUser } = require('../../lib/access');
const { leaveSteps, approversFor, nextIndex, stepLabel } = require('../../lib/workflow');
const { notify } = require('../../lib/notify');
const { botMessage } = require('../../lib/chat');
const leave = require('../../lib/leave');
const { pushLeave, removePushedLeave } = require('../../lib/calendar');
const { toDbDate, fromDbDate, today, addDays, yearOf, monthStart, monthEnd } = require('../../lib/time');

const router = express.Router();
router.use(authenticate);
router.use(requirePerm('module.leave', 'leave.approve', 'leave.configure'));

const include = {
  leaveType: { select: { id: true, name: true, colour: true, approvalSteps: true, workflowId: true } },
  user: { select: { id: true, name: true, departmentId: true, managerId: true } },
  step1By: { select: { name: true } }, finalBy: { select: { name: true } },
};

const requestView = (r) => ({
  id: r.id, userId: r.userId, userName: r.user?.name, leaveType: r.leaveType, dateFrom: fromDbDate(r.dateFrom), dateTo: fromDbDate(r.dateTo),
  halfDay: r.halfDay, days: r.days, reason: r.reason, attachmentId: r.attachmentId, state: r.state, stepIndex: r.stepIndex, refuseReason: r.refuseReason,
  step1By: r.step1By?.name || null, finalBy: r.finalBy?.name || null, createdAt: r.createdAt,
});

async function preview(user, body) {
  const leaveTypeId = intParam(body.leaveTypeId, 'leaveTypeId');
  const type = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } });
  if (!type || !type.active) throw new HttpError(400, 'Pick a leave type');
  const dateFrom = dateParam(body.dateFrom, 'dateFrom');
  const dateTo = dateParam(body.dateTo, 'dateTo');
  if (dateTo < dateFrom) throw new HttpError(400, 'The end date is before the start date');
  const halfDay = Boolean(body.halfDay);
  if (halfDay && !type.halfDayAllowed) throw new HttpError(400, 'This leave type does not allow half days');
  if (halfDay && dateFrom !== dateTo) throw new HttpError(400, 'A half day must be a single day');
  const full = await prisma.user.findUnique({ where: { id: user.id }, include: { schedule: true } });
  const { days, excluded } = await leave.workingDays(full, dateFrom, dateTo, halfDay);
  const { timezone: tz } = await getSettings();
  const balance = (await leave.balances(user.id, yearOf(dateFrom), { asOf: dateFrom, tz })).find((b) => b.leaveTypeId === type.id);
  const overlap = await prisma.leaveRequest.findFirst({
    where: { userId: user.id, state: { in: leave.LIVE_STATES }, dateFrom: { lte: toDbDate(dateTo) }, dateTo: { gte: toDbDate(dateFrom) } },
  });
  const problems = [];
  if (days <= 0) problems.push('Those dates contain no working days');
  if (overlap) problems.push('You already have leave on those dates');
  if (type.requiresAllocation && days > balance.bookable) problems.push(`You only have ${balance.bookable} day(s) available`);
  const attachmentRequired = type.attachmentAfterDays !== null && days > type.attachmentAfterDays;
  return { type, dateFrom, dateTo, halfDay, days, excluded, balance, bookable: balance.bookable, balanceAfter: type.requiresAllocation ? balance.bookable - days : null, problems, attachmentRequired };
}

router.get('/types', h(async (req, res) => {
  res.json({ types: await prisma.leaveType.findMany({ where: req.query.all ? {} : { active: true }, orderBy: { id: 'asc' } }) });
}));

router.get('/balances', h(async (req, res) => {
  const { timezone: tz } = await getSettings();
  const userId = req.query.userId ? intParam(req.query.userId, 'userId') : req.user.id;
  if (!(await canAccessUser(req.user, userId))) throw new HttpError(403, 'You do not have access to this person');
  const year = Number(req.query.year) || yearOf(today(tz));
  res.json({ year, balances: await leave.balances(userId, year), expiring: await leave.expiringDays(userId, year, tz) });
}));

router.post('/preview', h(async (req, res) => {
  const p = await preview(req.user, req.body);
  res.json({ days: p.days, excluded: p.excluded, bookable: p.bookable, balanceAfter: p.balanceAfter, problems: p.problems, attachmentRequired: p.attachmentRequired });
}));

router.get('/requests', h(async (req, res) => {
  const rows = await prisma.leaveRequest.findMany({ where: { userId: req.user.id }, include, orderBy: { dateFrom: 'desc' }, take: 50 });
  // The approval steps of each leave type, so the person can see who their request is with.
  const steps = new Map();
  for (const r of rows) {
    if (steps.has(r.leaveTypeId)) continue;
    const labels = [];
    for (const s of await leaveSteps(r.leaveType)) labels.push(await stepLabel(s));
    steps.set(r.leaveTypeId, labels);
  }
  res.json({ requests: rows.map((r) => ({ ...requestView(r), steps: steps.get(r.leaveTypeId) })) });
}));

router.post('/requests', h(async (req, res) => {
  required(req.body, ['leaveTypeId', 'dateFrom', 'dateTo']);
  const p = await preview(req.user, req.body);
  if (p.problems.length) throw new HttpError(422, p.problems[0], { problems: p.problems });
  if (p.attachmentRequired && !req.body.attachmentId) throw new HttpError(422, `${p.type.name} of more than ${p.type.attachmentAfterDays} days needs a supporting document`);
  const employee = await prisma.user.findUnique({ where: { id: req.user.id } });
  const asDraft = Boolean(req.body.draft);
  const route = asDraft ? { state: 'DRAFT', approverIds: [] } : await leave.routeSubmission(employee, p.type);
  const row = await prisma.leaveRequest.create({
    data: {
      userId: req.user.id, leaveTypeId: p.type.id, dateFrom: toDbDate(p.dateFrom), dateTo: toDbDate(p.dateTo), halfDay: p.halfDay, days: p.days,
      reason: req.body.reason, attachmentId: req.body.attachmentId ? Number(req.body.attachmentId) : null, state: route.state,
      finalAt: route.state === 'APPROVED' ? new Date() : null,
    },
    include,
  });
  if (route.state === 'APPROVED') await pushLeave(row);
  await audit(req, { entity: 'LeaveRequest', entityId: row.id, action: 'leave.submitted', after: { type: p.type.name, from: p.dateFrom, to: p.dateTo, days: p.days } });
  if (!asDraft) {
    await notify(route.approverIds, { type: 'approvals.leave', title: `${req.user.name} requested leave`, body: `${p.type.name}: ${p.dateFrom} to ${p.dateTo} (${p.days} days)`, link: '/team' });
  }
  res.status(201).json({ request: requestView(row) });
}));

// Admins can step in on any flow with more than the manager in it. Manager-only flows stay with the manager.
async function canOverride(user, type) {
  return isAdmin(user) && (await leaveSteps(type)).some((step) => step.kind !== 'MANAGER');
}

// Who the request is waiting on, as far as this user is concerned.
async function ensureCanDecide(req, row) {
  if (row.userId === req.user.id) throw new HttpError(403, 'You cannot approve your own leave');
  if (!leave.OPEN_STATES.includes(row.state)) throw new HttpError(409, 'This request has already been decided');
  if (await canOverride(req.user, row.leaveType)) return;
  const employee = await prisma.user.findUnique({ where: { id: row.userId } });
  if (!(await leave.approverIdsFor(row, employee, row.leaveType)).includes(req.user.id)) throw new HttpError(403, 'This request is not waiting for you');
}

async function finishApproval(req, row) {
  const updated = await prisma.leaveRequest.update({ where: { id: row.id }, data: { state: 'APPROVED', finalById: req.user.id, finalAt: new Date() }, include });
  await notify(row.userId, { type: 'approvals.leave', title: 'Your leave was approved', body: `${row.leaveType.name}: ${fromDbDate(row.dateFrom)} to ${fromDbDate(row.dateTo)}`, link: '/leave' });
  await botMessage(row.userId, `Your ${row.leaveType.name.toLowerCase()} (${fromDbDate(row.dateFrom)} to ${fromDbDate(row.dateTo)}) was approved by ${req.user.name}.`, '/leave');
  await pushLeave(updated);
  return updated;
}

router.post('/requests/:id/approve', requirePerm('leave.approve'), h(async (req, res) => {
  const id = intParam(req.params.id);
  const row = await prisma.leaveRequest.findUnique({ where: { id }, include: { leaveType: true } });
  if (!row) throw new HttpError(404, 'Request not found');
  await ensureCanDecide(req, row);
  const employee = await prisma.user.findUnique({ where: { id: row.userId } });
  const type = await prisma.leaveType.findUnique({ where: { id: row.leaveTypeId } });
  const steps = await leaveSteps(type);
  const next = await nextIndex(steps, row.stepIndex, employee, req.user.id);
  const finalNow = isAdmin(req.user) || next >= steps.length;
  let updated;
  if (finalNow) {
    updated = await finishApproval(req, row);
  } else {
    updated = await prisma.leaveRequest.update({ where: { id }, data: { state: 'PARTLY_APPROVED', stepIndex: next, step1ById: req.user.id, step1At: new Date() }, include });
    await notify(await approversFor(steps[next], employee), { type: 'approvals.leave', title: `${employee.name}'s leave needs the next approval`, body: `${row.leaveType.name}: ${fromDbDate(row.dateFrom)} to ${fromDbDate(row.dateTo)}`, link: '/team' });
    await notify(row.userId, { type: 'approvals.leave', title: 'Your leave passed a step', body: 'It now goes to the next approver.', link: '/leave' });
  }
  await audit(req, { entity: 'LeaveRequest', entityId: id, action: finalNow ? 'leave.approved' : 'leave.step1_approved', before: { state: row.state }, after: { state: updated.state } });
  res.json({ request: requestView(updated) });
}));

router.post('/requests/:id/refuse', requirePerm('leave.approve'), h(async (req, res) => {
  const id = intParam(req.params.id);
  required(req.body, ['reason']);
  const row = await prisma.leaveRequest.findUnique({ where: { id }, include: { leaveType: true } });
  if (!row) throw new HttpError(404, 'Request not found');
  await ensureCanDecide(req, row);
  const updated = await prisma.leaveRequest.update({ where: { id }, data: { state: 'REFUSED', refusedById: req.user.id, refuseReason: String(req.body.reason).slice(0, 500) }, include });
  await audit(req, { entity: 'LeaveRequest', entityId: id, action: 'leave.refused', before: { state: row.state }, after: { state: 'REFUSED', reason: req.body.reason } });
  await notify(row.userId, { type: 'approvals.leave', title: 'Your leave was refused', body: req.body.reason, link: '/leave' });
  await botMessage(row.userId, `Your ${row.leaveType.name.toLowerCase()} request was refused by ${req.user.name}: ${req.body.reason}`, '/leave');
  res.json({ request: requestView(updated) });
}));

// LV-05: cancelling works until the first day and restores the balance, since balances count live states only.
router.post('/requests/:id/cancel', h(async (req, res) => {
  const id = intParam(req.params.id);
  const row = await prisma.leaveRequest.findUnique({ where: { id }, include: { leaveType: true } });
  if (!row) throw new HttpError(404, 'Request not found');
  if (row.userId !== req.user.id && !isAdmin(req.user)) throw new HttpError(403, 'You can only cancel your own request');
  if (!['DRAFT', ...leave.LIVE_STATES].includes(row.state)) throw new HttpError(409, 'This request cannot be cancelled');
  const { timezone: tz } = await getSettings();
  if (fromDbDate(row.dateFrom) <= today(tz) && !isAdmin(req.user)) throw new HttpError(409, 'Leave that has started cannot be cancelled. Contact HR.');
  await prisma.leaveRequest.update({ where: { id }, data: { state: 'CANCELLED' } });
  await removePushedLeave(row);
  await audit(req, { entity: 'LeaveRequest', entityId: id, action: 'leave.cancelled', before: { state: row.state } });
  res.json({ ok: true });
}));

// BR-05: approved leave goes back to draft only through a Manager or Admin.
router.post('/requests/:id/reset', requirePerm('leave.approve'), h(async (req, res) => {
  const id = intParam(req.params.id);
  const row = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, 'Request not found');
  const managed = await teamIds(req.user);
  if (row.userId === req.user.id || !(managed === null || managed.includes(row.userId))) throw new HttpError(403, 'Only their manager or HR can reset approved leave');
  await prisma.leaveRequest.update({ where: { id }, data: { state: 'DRAFT', stepIndex: 0, finalById: null, finalAt: null, step1ById: null, step1At: null } });
  await removePushedLeave(row);
  await audit(req, { entity: 'LeaveRequest', entityId: id, action: 'leave.reset', before: { state: row.state }, after: { state: 'DRAFT' } });
  await notify(row.userId, { type: 'approvals.leave', title: 'Your leave was reset to draft', link: '/leave' });
  res.json({ ok: true });
}));

router.post('/requests/:id/submit', h(async (req, res) => {
  const id = intParam(req.params.id);
  const row = await prisma.leaveRequest.findUnique({ where: { id }, include: { leaveType: true } });
  if (!row || row.userId !== req.user.id) throw new HttpError(404, 'Request not found');
  if (row.state !== 'DRAFT') throw new HttpError(409, 'Only a draft can be submitted');
  const employee = await prisma.user.findUnique({ where: { id: req.user.id } });
  const route = await leave.routeSubmission(employee, row.leaveType);
  const updated = await prisma.leaveRequest.update({ where: { id }, data: { state: route.state }, include });
  await notify(route.approverIds, { type: 'approvals.leave', title: `${req.user.name} requested leave`, body: `${row.leaveType.name}: ${fromDbDate(row.dateFrom)} to ${fromDbDate(row.dateTo)}`, link: '/team' });
  res.json({ request: requestView(updated) });
}));

// Requests waiting on this user, with conflicts (LV-06).
async function pendingFor(user) {
  const ids = await teamIds(user);
  const anyone = ids === null || (await namedInWorkflow(user));
  const rows = await prisma.leaveRequest.findMany({
    where: { state: { in: leave.OPEN_STATES }, userId: anyone ? { not: user.id } : { in: ids } }, include: { ...include, user: true }, orderBy: { dateFrom: 'asc' },
  });
  const out = [];
  for (const r of rows) {
    if (!(await canOverride(user, r.leaveType)) && !(await leave.approverIdsFor(r, r.user, r.leaveType)).includes(user.id)) continue;
    const bal = (await leave.balances(r.userId, yearOf(fromDbDate(r.dateFrom)))).find((b) => b.leaveTypeId === r.leaveTypeId);
    out.push({ ...requestView(r), conflicts: await leave.conflicts(r, r.user), balanceAfter: bal?.requiresAllocation ? bal.bookable : null });
  }
  return out;
}

router.get('/inbox', requirePerm('leave.approve'), h(async (req, res) => res.json({ requests: await pendingFor(req.user) })));

// LV-08: team calendar, approved and pending, for the month.
router.get('/team-calendar', h(async (req, res) => {
  const { timezone: tz } = await getSettings();
  const anchor = req.query.month ? `${req.query.month}-01` : monthStart(today(tz));
  const from = monthStart(anchor);
  const to = monthEnd(anchor);
  const ids = await teamIds(req.user);
  let people;
  if (ids === null) people = { active: true };
  else if (ids.length) people = { id: { in: [req.user.id, ...ids] } };
  else {
    const me = await prisma.user.findUnique({ where: { id: req.user.id } });
    people = { active: true, OR: [{ departmentId: me.departmentId }, me.managerId ? { managerId: me.managerId } : { id: me.id }] };
  }
  const rows = await prisma.leaveRequest.findMany({
    where: { user: people, state: { in: leave.LIVE_STATES }, dateFrom: { lte: toDbDate(to) }, dateTo: { gte: toDbDate(from) } },
    include, orderBy: { dateFrom: 'asc' },
  });
  res.json({ from, to, entries: rows.map(requestView) });
}));

// LV-14
router.get('/overview', h(async (req, res) => {
  const { timezone: tz } = await getSettings();
  const day = today(tz);
  const me = await prisma.user.findUnique({ where: { id: req.user.id } });
  const peers = await prisma.user.findMany({
    where: { active: true, OR: [me.departmentId ? { departmentId: me.departmentId } : { id: me.id }, me.managerId ? { managerId: me.managerId } : { id: me.id }] }, select: { id: true },
  });
  const off = await prisma.leaveRequest.findMany({
    where: { userId: { in: peers.map((p) => p.id) }, state: { in: leave.LIVE_STATES }, dateTo: { gte: toDbDate(day) }, dateFrom: { lte: toDbDate(addDays(day, 45)) } },
    include, orderBy: { dateFrom: 'asc' }, take: 10,
  });
  const holidays = await prisma.publicHoliday.findMany({ where: { date: { gte: toDbDate(day) } }, orderBy: { date: 'asc' }, take: 4 });
  res.json({
    off: off.map((r) => ({ id: r.id, name: r.userId === req.user.id ? 'You' : r.user.name, from: fromDbDate(r.dateFrom), to: fromDbDate(r.dateTo), pending: r.state !== 'APPROVED' })),
    holidays: holidays.map((x) => ({ date: fromDbDate(x.date), name: x.name })),
  });
}));

router.get('/statement', h(async (req, res) => {
  const { timezone: tz } = await getSettings();
  const userId = req.query.userId ? intParam(req.query.userId, 'userId') : req.user.id;
  if (!(await canAccessUser(req.user, userId))) throw new HttpError(403, 'You do not have access to this person');
  const year = Number(req.query.year) || yearOf(today(tz));
  const leaveTypeId = intParam(req.query.leaveTypeId, 'leaveTypeId');
  const data = await leave.statement(userId, leaveTypeId, year);
  if (req.query.format !== 'pdf') return res.json(data);

  const owner = await prisma.user.findUnique({ where: { id: userId } });
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="leave-statement-${year}.pdf"`);
  doc.pipe(res);
  doc.fontSize(20).fillColor('#1a1a1a').text((await getSettings()).companyName, { continued: false });
  doc.moveDown(0.4).fontSize(14).text(`${data.type.name} statement · ${year}`);
  doc.fontSize(10).fillColor('#555').text(`${owner.name} · ${owner.employeeNo}`).text(`Generated ${today(tz)}`);
  doc.moveDown(1);
  const row = (a, b, c, bold) => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#1a1a1a');
    doc.text(a, 50, y, { width: 240 });
    doc.text(b, 300, y, { width: 150 });
    doc.text(c, 460, y, { width: 85, align: 'right' });
    doc.moveDown(0.6);
  };
  const signed = (n) => `${n > 0 ? '+' : ''}${n}`;
  row('Item', 'Period', 'Days', true);
  data.lines.forEach((l) => row(l.label, l.period, signed(l.days)));
  row('Available today', '', String(data.availableToday), true);
  data.pending.forEach((l) => row(l.label, `${l.period} · ${l.status}`, signed(l.days)));
  doc.end();
  return undefined;
}));

// Leave type configuration (LV-01)
const typeFields = (b) => ({
  name: b.name, colour: b.colour, requiresAllocation: b.requiresAllocation, approvalSteps: b.approvalSteps, workflowId: b.workflowId === undefined ? undefined : b.workflowId ? Number(b.workflowId) : null,
  attachmentAfterDays: b.attachmentAfterDays === '' ? null : b.attachmentAfterDays, halfDayAllowed: b.halfDayAllowed,
  accrualPerMonth: b.accrualPerMonth === '' ? null : b.accrualPerMonth, defaultDays: b.defaultDays === '' ? null : b.defaultDays,
  maxCarryOver: b.maxCarryOver === '' ? null : b.maxCarryOver, carryExpiry: b.carryExpiry || null, active: b.active,
});

router.post('/types', requirePerm('leave.configure'), h(async (req, res) => {
  required(req.body, ['name']);
  const type = await prisma.leaveType.create({ data: typeFields(req.body) });
  await audit(req, { entity: 'LeaveType', entityId: type.id, action: 'leave_type.created', after: type });
  res.status(201).json({ type });
}));

router.patch('/types/:id', requirePerm('leave.configure'), h(async (req, res) => {
  const id = intParam(req.params.id);
  const before = await prisma.leaveType.findUnique({ where: { id } });
  const type = await prisma.leaveType.update({ where: { id }, data: typeFields(req.body) });
  await audit(req, { entity: 'LeaveType', entityId: id, action: 'leave_type.updated', before, after: type });
  res.json({ type });
}));

// LV-02: one person, several, or a department.
router.post('/allocations', requirePerm('leave.configure'), h(async (req, res) => {
  required(req.body, ['leaveTypeId', 'days', 'periodStart', 'periodEnd']);
  let userIds = (req.body.userIds || []).map(Number);
  if (req.body.departmentId) userIds = (await prisma.user.findMany({ where: { active: true, departmentId: Number(req.body.departmentId) }, select: { id: true } })).map((u) => u.id);
  if (req.body.everyone) userIds = (await prisma.user.findMany({ where: { active: true, role: { not: 'SUPER_ADMIN' } }, select: { id: true } })).map((u) => u.id);
  if (!userIds.length) throw new HttpError(400, 'Pick at least one person');
  const days = Number(req.body.days);
  if (!Number.isFinite(days)) throw new HttpError(400, 'Days must be a number');
  const { count } = await prisma.leaveAllocation.createMany({
    data: userIds.map((userId) => ({
      userId, leaveTypeId: Number(req.body.leaveTypeId), days, kind: 'GRANT', note: req.body.note || null, createdById: req.user.id,
      periodStart: toDbDate(dateParam(req.body.periodStart, 'periodStart')), periodEnd: toDbDate(dateParam(req.body.periodEnd, 'periodEnd')),
    })),
  });
  await audit(req, { entity: 'LeaveAllocation', action: 'allocation.granted', after: { leaveTypeId: req.body.leaveTypeId, days, people: count } });
  res.status(201).json({ created: count });
}));

module.exports = { router, pendingFor };
