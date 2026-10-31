const express = require('express');
const prisma = require('../../lib/prisma');
const { authenticate, requirePerm } = require('../middleware/auth');
const { HttpError, h, required, intParam, dateParam } = require('../middleware/validation');
const { getSettings } = require('../../lib/settings');
const { can, namedInWorkflow } = require('../../lib/permissions');
const { audit } = require('../../lib/audit');
const { isAdmin, canAccessUser, teamIds, visibleUserFilter } = require('../../lib/access');
const { timesheetSteps, approversFor, nextIndex } = require('../../lib/workflow');
const { notify } = require('../../lib/notify');
const { botMessage } = require('../../lib/chat');
const { holidaysBetween, approvedLeaveDays, scheduleOf, shiftOn } = require('../../lib/attendance');
const { toDbDate, fromDbDate, today, addDays, eachDay, mondayOf, round2 } = require('../../lib/time');

const router = express.Router();
router.use(authenticate);

// Accepts 3.5 or 3:30 (TS-01).
function parseHours(value) {
  const s = String(value ?? '').trim();
  if (s === '') return 0;
  const m = s.match(/^(\d{1,2}):([0-5]?\d)$/);
  const hours = m ? Number(m[1]) + Number(m[2]) / 60 : Number(s);
  if (!Number.isFinite(hours) || hours < 0) throw new HttpError(400, 'Enter hours as 3.5 or 3:30');
  return round2(hours);
}

// Admins don't keep timesheets by default: logging is a screen permission on the role.
async function targetUser(req, raw) {
  if (!raw || Number(raw) === req.user.id) {
    if (!(await can(req.user, 'module.timesheets'))) throw new HttpError(403, 'Your role does not log timesheets');
    return req.user.id;
  }
  const id = intParam(raw, 'userId');
  if (!(await can(req.user, 'timesheets.log_for_others'))) throw new HttpError(403, 'You can only log your own time');
  return id;
}

const optInt = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

// As in Odoo, the task is optional: a line can sit on the project alone.
async function assertProjectTask(projectId, taskId) {
  const project = await prisma.project.findFirst({ where: { id: projectId, active: true } });
  if (!project) throw new HttpError(400, 'Pick an active project');
  if (taskId && !(await prisma.task.findFirst({ where: { id: taskId, projectId, active: true } }))) throw new HttpError(400, 'That task is not on this project');
  return project;
}

// The tagged person gets an in-app notification once per entry.
async function notifyAssisted(actor, assistedUserId, project, date, description) {
  if (!assistedUserId || assistedUserId === actor.id) return;
  await notify(assistedUserId, {
    type: 'tagged.timesheet', title: `${actor.name} tagged you as assisting on ${project.name}`,
    body: `${date}${description ? `: ${description}` : ''}`, link: '/timesheets',
  });
}

async function assertAssisted(id) {
  if (!id) return;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user?.active) throw new HttpError(400, 'That person is not active');
}

async function assertWeekOpen(userId, date) {
  const locked = await prisma.timesheetLine.findFirst({
    where: { userId, state: { not: 'DRAFT' }, date: { gte: toDbDate(mondayOf(date)), lte: toDbDate(addDays(mondayOf(date), 6)) } },
  });
  if (locked) throw new HttpError(423, 'This week has been validated and is locked');
}

async function assertDayTotal(userId, date, newTotalForRest) {
  if (newTotalForRest > 24) throw new HttpError(422, 'A day cannot total more than 24 hours');
}

// A grid cell is the sum of every line for that project, task and day. Typing a new total adjusts the latest line (TS-06, UC-04 4a).
async function setCell({ userId, date, projectId, taskId, hours, description, add = false }) {
  await assertWeekOpen(userId, date);
  const lines = await prisma.timesheetLine.findMany({ where: { userId, date: toDbDate(date), projectId, taskId: taskId ?? null }, orderBy: { id: 'asc' } });
  const current = lines.reduce((sum, l) => sum + l.hours, 0);
  const next = round2(add ? current + hours : hours);
  const day = await prisma.timesheetLine.aggregate({ where: { userId, date: toDbDate(date) }, _sum: { hours: true } });
  await assertDayTotal(userId, date, (day._sum.hours || 0) - current + next);
  const last = lines[lines.length - 1];
  if (!last) return prisma.timesheetLine.create({ data: { userId, date: toDbDate(date), projectId, taskId: taskId ?? null, hours: next, description } });
  const hoursOnLast = round2(last.hours + (next - current));
  if (hoursOnLast < 0) throw new HttpError(422, 'This cell has several entries. Change them under Entries.');
  return prisma.timesheetLine.update({ where: { id: last.id }, data: { hours: hoursOnLast, description: description === undefined ? undefined : description } });
}

async function gridFor(userId, weekStart, tz) {
  const days = eachDay(weekStart, addDays(weekStart, 6));
  const end = days[6];
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { schedule: true } });
  const [lines, attendance, holidays, leave, timer] = await Promise.all([
    prisma.timesheetLine.findMany({ where: { userId, date: { gte: toDbDate(weekStart), lte: toDbDate(end) } }, include: { project: true, task: true }, orderBy: { id: 'asc' } }),
    prisma.attendance.findMany({ where: { userId, deletedAt: null, date: { gte: toDbDate(weekStart), lte: toDbDate(end) } } }),
    holidaysBetween(weekStart, end),
    approvedLeaveDays([userId], weekStart, end),
    prisma.timerSession.findUnique({ where: { userId }, include: { project: true, task: true } }),
  ]);
  const rows = new Map();
  for (const l of lines) {
    const key = `${l.projectId}:${l.taskId || 0}`;
    if (!rows.has(key)) rows.set(key, { key, projectId: l.projectId, taskId: l.taskId, project: l.project.name, task: l.task?.name || null, cells: {}, total: 0 });
    const row = rows.get(key);
    const date = fromDbDate(l.date);
    row.cells[date] = { hours: round2((row.cells[date]?.hours || 0) + l.hours), state: l.state };
    row.total = round2(row.total + l.hours);
  }
  const schedule = scheduleOf(user);
  const leaveDays = leave.get(userId);
  const dayInfo = days.map((date) => {
    const logged = round2(lines.filter((l) => fromDbDate(l.date) === date).reduce((s, l) => s + l.hours, 0));
    const recs = attendance.filter((a) => fromDbDate(a.date) === date);
    const open = recs.some((r) => !r.checkOut);
    const attended = round2(recs.reduce((s, r) => s + (r.workedHours || 0), 0));
    return {
      date, logged, attended, open, hasAttendance: recs.length > 0, autoClosed: recs.some((r) => r.autoClosed && !r.isEdited),
      holiday: holidays.get(date) || null, leave: leaveDays?.get(date)?.leaveType.name || null, scheduled: Boolean(shiftOn(schedule, date)),
    };
  });
  const states = lines.map((l) => l.state);
  const state = states.includes('VALIDATED') ? 'VALIDATED' : states.includes('PARTLY_VALIDATED') ? 'PARTLY_VALIDATED' : 'DRAFT';
  return {
    weekStart, weekEnd: end, days: dayInfo, rows: [...rows.values()], state,
    totalLogged: round2(dayInfo.reduce((s, d) => s + d.logged, 0)), totalAttended: round2(dayInfo.reduce((s, d) => s + d.attended, 0)),
    scheduled: dayInfo.filter((d) => d.scheduled && !d.holiday && !d.leave).length * schedule.hoursPerDay,
    timer: timer ? { projectId: timer.projectId, taskId: timer.taskId, project: timer.project.name, task: timer.task?.name || null, description: timer.description, startedAt: timer.startedAt } : null,
    serverNow: new Date(),
  };
}

router.get('/grid', h(async (req, res) => {
  const { timezone: tz } = await getSettings();
  const userId = req.query.userId ? intParam(req.query.userId, 'userId') : req.user.id;
  if (!(await canAccessUser(req.user, userId))) throw new HttpError(403, 'You do not have access to this person');
  if (userId === req.user.id && !(await can(req.user, 'module.timesheets'))) throw new HttpError(403, 'Your role does not log timesheets');
  const week = req.query.week ? mondayOf(dateParam(req.query.week, 'week')) : mondayOf(today(tz));
  res.json(await gridFor(userId, week, tz));
}));

// Everyone a person can tag as "worked with". Names only, so it works without access to the People screen.
router.get('/people', h(async (req, res) => {
  const people = await prisma.user.findMany({ where: { active: true, id: { not: req.user.id } }, select: { id: true, name: true, jobTitle: true }, orderBy: { name: 'asc' } });
  res.json({ people });
}));

router.get('/projects', h(async (req, res) => {
  const projects = await prisma.project.findMany({
    where: { active: true },
    include: { tasks: { where: { active: true }, select: { id: true, name: true } } }, orderBy: { name: 'asc' },
  });
  res.json({ projects });
}));

router.put('/cell', h(async (req, res) => {
  required(req.body, ['date', 'projectId']);
  const userId = await targetUser(req, req.body.userId);
  const date = dateParam(req.body.date);
  const projectId = intParam(req.body.projectId, 'projectId');
  const taskId = optInt(req.body.taskId);
  await assertProjectTask(projectId, taskId);
  const hours = parseHours(req.body.hours);
  const line = await setCell({ userId, date, projectId, taskId, hours, description: req.body.description });
  if (userId !== req.user.id) await audit(req, { entity: 'TimesheetLine', entityId: line.id, action: 'timesheet.logged_for', after: { userId, date, hours } });
  res.json({ line });
}));

// "Add a line": a zero-hours line on the first day keeps the row in the grid (TS-04).
router.post('/rows', h(async (req, res) => {
  required(req.body, ['week', 'projectId']);
  const userId = await targetUser(req, req.body.userId);
  const projectId = intParam(req.body.projectId, 'projectId');
  const taskId = optInt(req.body.taskId);
  await assertProjectTask(projectId, taskId);
  const date = mondayOf(dateParam(req.body.week, 'week'));
  const existing = await prisma.timesheetLine.findFirst({
    where: { userId, projectId, taskId: taskId ?? null, date: { gte: toDbDate(date), lte: toDbDate(addDays(date, 6)) } },
  });
  if (existing) return res.json({ ok: true });
  await setCell({ userId, date, projectId, taskId, hours: 0 });
  return res.status(201).json({ ok: true });
}));

router.delete('/rows', h(async (req, res) => {
  required(req.body, ['week', 'projectId']);
  const week = mondayOf(dateParam(req.body.week, 'week'));
  const where = {
    userId: req.user.id, projectId: Number(req.body.projectId), taskId: optInt(req.body.taskId),
    date: { gte: toDbDate(week), lte: toDbDate(addDays(week, 6)) },
  };
  if (await prisma.timesheetLine.findFirst({ where: { ...where, state: { not: 'DRAFT' } } })) throw new HttpError(423, 'This week has been validated and is locked');
  await prisma.timesheetLine.deleteMany({ where });
  res.json({ ok: true });
}));

// Time on a timer rounds up to the company's step, then lands in today's cell (TS-05).
async function stopTimer(user, tz) {
  const timer = await prisma.timerSession.findUnique({ where: { userId: user.id } });
  if (!timer) return null;
  const { timesheets } = await getSettings();
  const stepMinutes = timesheets.roundingMinutes;
  const minutes = (Date.now() - timer.startedAt.getTime()) / 60000;
  const rounded = Math.ceil(Math.max(minutes, 0.01) / stepMinutes) * stepMinutes;
  const hours = round2(rounded / 60);
  const date = today(tz);
  await prisma.timerSession.delete({ where: { userId: user.id } });
  if (timer.description || timer.assistedUserId) {
    await assertWeekOpen(user.id, date);
    await prisma.timesheetLine.create({ data: { userId: user.id, date: toDbDate(date), projectId: timer.projectId, taskId: timer.taskId, hours, description: timer.description, assistedUserId: timer.assistedUserId } });
    const project = await prisma.project.findUnique({ where: { id: timer.projectId } });
    await notifyAssisted(user, timer.assistedUserId, project, date, timer.description);
  } else {
    await setCell({ userId: user.id, date, projectId: timer.projectId, taskId: timer.taskId, hours, add: true });
  }
  return { hours, date, projectId: timer.projectId, taskId: timer.taskId };
}

router.post('/timer/start', h(async (req, res) => {
  required(req.body, ['projectId']);
  await targetUser(req);
  const { timezone: tz } = await getSettings();
  const projectId = intParam(req.body.projectId, 'projectId');
  const taskId = optInt(req.body.taskId);
  const assistedUserId = optInt(req.body.assistedUserId);
  await assertProjectTask(projectId, taskId);
  await assertAssisted(assistedUserId);
  // One timer at a time: starting a new one banks the old one first, as Odoo does.
  const stopped = await stopTimer(req.user, tz);
  const timer = await prisma.timerSession.create({ data: { userId: req.user.id, projectId, taskId, assistedUserId, description: req.body.description || null } });
  res.status(201).json({ timer, stopped, serverNow: new Date() });
}));

router.post('/timer/stop', h(async (req, res) => {
  const { timezone: tz } = await getSettings();
  const stopped = await stopTimer(req.user, tz);
  if (!stopped) throw new HttpError(409, 'No timer is running');
  res.json({ stopped });
}));

// Entries: the Odoo line form (date, project, task, person assisted, description, time spent).
async function ownedEntry(req) {
  const line = await prisma.timesheetLine.findUnique({ where: { id: intParam(req.params.id) } });
  if (!line) throw new HttpError(404, 'Entry not found');
  if (line.userId !== req.user.id && !(await can(req.user, 'timesheets.log_for_others'))) throw new HttpError(403, 'This is not your entry');
  if (line.state !== 'DRAFT') throw new HttpError(423, 'This week has been validated and is locked');
  return line;
}

router.post('/entries', h(async (req, res) => {
  required(req.body, ['date', 'projectId']);
  const userId = await targetUser(req, req.body.userId);
  const date = dateParam(req.body.date);
  const projectId = intParam(req.body.projectId, 'projectId');
  const taskId = optInt(req.body.taskId);
  const assistedUserId = optInt(req.body.assistedUserId);
  const project = await assertProjectTask(projectId, taskId);
  await assertAssisted(assistedUserId);
  const hours = parseHours(req.body.hours);
  await assertWeekOpen(userId, date);
  const day = await prisma.timesheetLine.aggregate({ where: { userId, date: toDbDate(date) }, _sum: { hours: true } });
  await assertDayTotal(userId, date, (day._sum.hours || 0) + hours);
  const line = await prisma.timesheetLine.create({ data: { userId, date: toDbDate(date), projectId, taskId, assistedUserId, hours, description: req.body.description || null } });
  await notifyAssisted(req.user, assistedUserId, project, date, line.description);
  res.status(201).json({ line });
}));

router.patch('/entries/:id', h(async (req, res) => {
  const line = await ownedEntry(req);
  const b = req.body;
  const date = b.date ? dateParam(b.date) : fromDbDate(line.date);
  const projectId = b.projectId ? Number(b.projectId) : line.projectId;
  const taskId = b.taskId === undefined ? line.taskId : optInt(b.taskId);
  const assistedUserId = b.assistedUserId === undefined ? line.assistedUserId : optInt(b.assistedUserId);
  const hours = b.hours === undefined ? line.hours : parseHours(b.hours);
  const project = await assertProjectTask(projectId, taskId);
  await assertAssisted(assistedUserId);
  await assertWeekOpen(line.userId, date);
  const day = await prisma.timesheetLine.aggregate({ where: { userId: line.userId, date: toDbDate(date), id: { not: line.id } }, _sum: { hours: true } });
  await assertDayTotal(line.userId, date, (day._sum.hours || 0) + hours);
  const updated = await prisma.timesheetLine.update({
    where: { id: line.id }, data: { date: toDbDate(date), projectId, taskId, assistedUserId, hours, description: b.description === undefined ? undefined : b.description || null },
  });
  if (assistedUserId !== line.assistedUserId) await notifyAssisted(req.user, assistedUserId, project, date, updated.description);
  res.json({ line: updated });
}));

router.delete('/entries/:id', h(async (req, res) => {
  const line = await ownedEntry(req);
  await prisma.timesheetLine.delete({ where: { id: line.id } });
  res.json({ ok: true });
}));

router.get('/lines', h(async (req, res) => {
  const { timezone: tz } = await getSettings();
  const to = req.query.to ? dateParam(req.query.to, 'to') : addDays(mondayOf(today(tz)), 6);
  const from = req.query.from ? dateParam(req.query.from, 'from') : addDays(to, -34);
  const scope = req.query.scope || 'mine';
  const where = { date: { gte: toDbDate(from), lte: toDbDate(to) }, hours: { gt: 0 } };
  if (scope === 'mine') where.userId = req.user.id;
  else where.user = await visibleUserFilter(req.user);
  if (req.query.projectId) where.projectId = Number(req.query.projectId);
  if (req.query.taskId) where.taskId = Number(req.query.taskId);
  if (req.query.state === 'validated') where.state = 'VALIDATED';
  if (req.query.state === 'open') where.state = { not: 'VALIDATED' };
  const lines = await prisma.timesheetLine.findMany({
    where, orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 2000,
    include: { project: { select: { name: true } }, task: { select: { name: true } }, user: { select: { id: true, name: true } }, assisted: { select: { id: true, name: true } } },
  });
  res.json({
    lines: lines.map((l) => ({
      id: l.id, date: fromDbDate(l.date), hours: l.hours, description: l.description, state: l.state, projectId: l.projectId, taskId: l.taskId, project: l.project.name,
      task: l.task?.name || null, assisted: l.assisted, userId: l.userId, userName: l.user.name,
    })),
    total: round2(lines.reduce((s, l) => s + l.hours, 0)),
  });
}));

const weekWhere = (userId, week) => ({ userId, date: { gte: toDbDate(week), lte: toDbDate(addDays(week, 6)) } });

// Each step of the timesheet workflow validates in turn; Admin can finish it at any point (TS-07, BR-08).
router.post('/validate', requirePerm('timesheets.validate'), h(async (req, res) => {
  required(req.body, ['userId', 'week']);
  const userId = intParam(req.body.userId, 'userId');
  const week = mondayOf(dateParam(req.body.week, 'week'));
  if (userId === req.user.id) throw new HttpError(403, 'You cannot validate your own timesheet');
  if (!(await canAccessUser(req.user, userId)) && !(await namedInWorkflow(req.user))) throw new HttpError(403, 'This person is not on your team');
  const employee = await prisma.user.findUnique({ where: { id: userId } });
  const lines = await prisma.timesheetLine.findMany({ where: { ...weekWhere(userId, week), hours: { gt: 0 } } });
  if (!lines.length) throw new HttpError(400, 'No hours logged for this week');
  if (lines.every((l) => l.state === 'VALIDATED')) throw new HttpError(409, 'This week is already validated');

  const steps = await timesheetSteps();
  const index = Math.min(...lines.filter((l) => l.state !== 'VALIDATED').map((l) => l.stepIndex));
  const admin = isAdmin(req.user);
  if (!admin && !(await approversFor(steps[index], employee)).includes(req.user.id)) {
    throw new HttpError(409, 'This week is waiting for another approver');
  }
  const next = await nextIndex(steps, index, employee, req.user.id);
  const isFinal = admin || next >= steps.length;
  const data = isFinal ? { state: 'VALIDATED', validatedById: req.user.id } : { state: 'PARTLY_VALIDATED', stepIndex: next, step1ById: req.user.id };
  await prisma.timesheetLine.updateMany({ where: weekWhere(userId, week), data });
  await audit(req, { entity: 'TimesheetWeek', entityId: `${userId}:${week}`, action: isFinal ? 'timesheet.validated' : 'timesheet.step1', after: { hours: round2(lines.reduce((s, l) => s + l.hours, 0)) } });
  if (isFinal) {
    await notify(userId, { type: 'approvals.timesheet', title: 'Your timesheet was validated', body: `Week of ${week}`, link: '/timesheets' });
    await botMessage(userId, `Your timesheet for the week of ${week} was validated by ${req.user.name}.`, '/timesheets');
  } else {
    await notify(await approversFor(steps[next], employee), { type: 'approvals.timesheet', title: `${employee.name}'s timesheet needs validation`, body: `Week of ${week}`, link: '/team' });
  }
  res.json({ state: data.state });
}));

// BR-05: only a Manager or Admin can reopen a validated week.
router.post('/reset', requirePerm('timesheets.validate'), h(async (req, res) => {
  required(req.body, ['userId', 'week']);
  const userId = intParam(req.body.userId, 'userId');
  if (userId === req.user.id) throw new HttpError(403, 'You cannot reset your own timesheet');
  const managed = await teamIds(req.user);
  if (!(managed === null || managed.includes(userId))) throw new HttpError(403, 'Only their manager or HR can reset a validated week');
  const week = mondayOf(dateParam(req.body.week, 'week'));
  await prisma.timesheetLine.updateMany({ where: weekWhere(userId, week), data: { state: 'DRAFT', stepIndex: 0, validatedById: null, step1ById: null } });
  await audit(req, { entity: 'TimesheetWeek', entityId: `${userId}:${week}`, action: 'timesheet.reset' });
  await notify(userId, { type: 'approvals.timesheet', title: 'Your timesheet was reopened', body: `Week of ${week}: you can edit it again.`, link: '/timesheets' });
  res.json({ ok: true });
}));

// Project and task management (USR-05). Managers are limited to their own department.
async function assertProjectAccess(req, departmentId) {
  if (isAdmin(req.user)) return;
  if (!departmentId || departmentId !== req.user.departmentId) throw new HttpError(403, 'Managers can manage projects in their own department only');
}

router.get('/projects/manage', requirePerm('projects.manage'), h(async (req, res) => {
  const where = isAdmin(req.user) ? {} : { departmentId: req.user.departmentId };
  const projects = await prisma.project.findMany({ where, include: { tasks: true, department: { select: { name: true } } }, orderBy: { name: 'asc' } });
  res.json({ projects });
}));

router.post('/projects', requirePerm('projects.manage'), h(async (req, res) => {
  required(req.body, ['name']);
  const departmentId = isAdmin(req.user) ? (req.body.departmentId ? Number(req.body.departmentId) : null) : req.user.departmentId;
  await assertProjectAccess(req, departmentId);
  const project = await prisma.project.create({ data: { name: req.body.name, departmentId, tasks: { create: (req.body.tasks || []).map((name) => ({ name })) } }, include: { tasks: true } });
  await audit(req, { entity: 'Project', entityId: project.id, action: 'project.created', after: { name: project.name } });
  res.status(201).json({ project });
}));

router.patch('/projects/:id', requirePerm('projects.manage'), h(async (req, res) => {
  const id = intParam(req.params.id);
  const before = await prisma.project.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, 'Project not found');
  await assertProjectAccess(req, before.departmentId);
  const project = await prisma.project.update({ where: { id }, data: { name: req.body.name, active: req.body.active } });
  await audit(req, { entity: 'Project', entityId: id, action: 'project.updated', before, after: project });
  res.json({ project });
}));

router.post('/projects/:id/tasks', requirePerm('projects.manage'), h(async (req, res) => {
  required(req.body, ['name']);
  const id = intParam(req.params.id);
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) throw new HttpError(404, 'Project not found');
  await assertProjectAccess(req, project.departmentId);
  res.status(201).json({ task: await prisma.task.create({ data: { projectId: id, name: req.body.name } }) });
}));

router.patch('/tasks/:id', requirePerm('projects.manage'), h(async (req, res) => {
  const id = intParam(req.params.id);
  const task = await prisma.task.findUnique({ where: { id }, include: { project: true } });
  if (!task) throw new HttpError(404, 'Task not found');
  await assertProjectAccess(req, task.project.departmentId);
  res.json({ task: await prisma.task.update({ where: { id }, data: { name: req.body.name, active: req.body.active } }) });
}));

// Weeks waiting on this person, used by the approvals inbox.
async function pendingWeeks(user) {
  const ids = await teamIds(user);
  const anyone = ids === null || (await namedInWorkflow(user));
  const { timezone: tz } = await getSettings();
  const thisWeek = mondayOf(today(tz));
  const lines = await prisma.timesheetLine.findMany({
    where: {
      state: { not: 'VALIDATED' }, hours: { gt: 0 }, date: { gte: toDbDate(addDays(thisWeek, -56)), lt: toDbDate(thisWeek) },
      userId: anyone ? { not: user.id } : { in: ids },
    },
    include: { user: true },
  });
  const steps = await timesheetSteps();
  const weeks = new Map();
  for (const l of lines) {
    const week = mondayOf(fromDbDate(l.date));
    const key = `${l.userId}:${week}`;
    if (!weeks.has(key)) weeks.set(key, { userId: l.userId, name: l.user.name, week, hours: 0, state: 'PARTLY_VALIDATED', stepIndex: l.stepIndex, employee: l.user });
    const w = weeks.get(key);
    w.hours = round2(w.hours + l.hours);
    if (l.state === 'DRAFT') { w.state = 'DRAFT'; w.stepIndex = 0; }
  }
  const out = [];
  for (const w of weeks.values()) {
    if (!isAdmin(user) && !(await approversFor(steps[w.stepIndex] || steps[0], w.employee)).includes(user.id)) continue;
    const attended = await prisma.attendance.aggregate({ where: { userId: w.userId, deletedAt: null, date: { gte: toDbDate(w.week), lte: toDbDate(addDays(w.week, 6)) } }, _sum: { workedHours: true } });
    out.push({ userId: w.userId, name: w.name, week: w.week, hours: w.hours, attended: round2(attended._sum.workedHours || 0), state: w.state });
  }
  return out.sort((a, b) => a.week.localeCompare(b.week));
}

module.exports = { router, pendingWeeks, gridFor, parseHours };
