const express = require('express');
const prisma = require('../../lib/prisma');
const { authenticate, requirePerm } = require('../middleware/auth');
const { HttpError, h, required, intParam, dateParam } = require('../middleware/validation');
const { can } = require('../../lib/permissions');
const { audit } = require('../../lib/audit');
const { notify } = require('../../lib/notify');
const { getSettings, updateSettings } = require('../../lib/settings');
const { canAccessUser, managerOf, teamIds } = require('../../lib/access');
const { toDbDate, fromDbDate } = require('../../lib/time');

const router = express.Router();
router.use(authenticate);
router.use(requirePerm('module.appraisals', 'appraisals.manage'));

const isHr = (user) => can(user, 'appraisals.manage');

async function names(ids) {
  const rows = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true, jobTitle: true } });
  return new Map(rows.map((u) => [u.id, u]));
}

// Like Odoo: neither side sees the other's feedback until the manager finishes the appraisal.
function view(a, viewer, people) {
  const done = a.state === 'DONE';
  const owner = a.userId === viewer.id;
  const lead = a.managerId === viewer.id;
  return {
    id: a.id, userId: a.userId, managerId: a.managerId, userName: people.get(a.userId)?.name, jobTitle: people.get(a.userId)?.jobTitle, managerName: people.get(a.managerId)?.name,
    deadline: fromDbDate(a.deadline), state: a.state, employeeDone: a.employeeDone, managerDone: a.managerDone, rating: done || lead ? a.rating : null, isEmployee: owner, isManager: lead,
    employeeFeedback: owner || done || (lead && a.employeeDone) ? a.employeeFeedback : null,
    managerFeedback: lead || done ? a.managerFeedback : null,
  };
}

async function load(req) {
  const a = await prisma.appraisal.findUnique({ where: { id: intParam(req.params.id) } });
  if (!a) throw new HttpError(404, 'Appraisal not found');
  if (a.userId !== req.user.id && a.managerId !== req.user.id && !(await isHr(req.user))) throw new HttpError(403, 'You do not have access to this appraisal');
  return a;
}

router.get('/settings', h(async (req, res) => {
  const { appraisal } = await getSettings();
  res.json({ appraisal });
}));

router.put('/settings', h(async (req, res) => {
  if (!(await isHr(req.user))) throw new HttpError(403, 'Only HR can change this');
  await updateSettings('appraisal', { employeeTemplate: req.body.employeeTemplate, managerTemplate: req.body.managerTemplate });
  res.json({ ok: true });
}));

// Goals (declared before /:id)
router.get('/goals', h(async (req, res) => {
  const userId = req.query.userId ? intParam(req.query.userId, 'userId') : req.user.id;
  if (!(await canAccessUser(req.user, userId))) throw new HttpError(403, 'You do not have access to this person');
  const goals = await prisma.appraisalGoal.findMany({ where: { userId }, orderBy: [{ progress: 'asc' }, { deadline: 'asc' }] });
  res.json({ goals: goals.map((g) => ({ ...g, deadline: g.deadline ? fromDbDate(g.deadline) : null })) });
}));

router.post('/goals', h(async (req, res) => {
  required(req.body, ['title']);
  const userId = req.body.userId ? intParam(req.body.userId, 'userId') : req.user.id;
  if (!(await canAccessUser(req.user, userId))) throw new HttpError(403, 'You do not have access to this person');
  const goal = await prisma.appraisalGoal.create({ data: { userId, title: req.body.title, description: req.body.description || null, deadline: req.body.deadline ? toDbDate(dateParam(req.body.deadline)) : null, createdById: req.user.id } });
  if (userId !== req.user.id) await notify(userId, { type: 'appraisal.goal', title: `${req.user.name} set you a goal`, body: goal.title, link: '/appraisals' });
  res.status(201).json({ goal });
}));

router.patch('/goals/:goalId', h(async (req, res) => {
  const id = intParam(req.params.goalId, 'goal');
  const goal = await prisma.appraisalGoal.findUnique({ where: { id } });
  if (!goal) throw new HttpError(404, 'Goal not found');
  if (!(await canAccessUser(req.user, goal.userId))) throw new HttpError(403, 'You do not have access to this goal');
  const progress = req.body.progress === undefined ? undefined : Math.min(100, Math.max(0, Number(req.body.progress)));
  res.json({ goal: await prisma.appraisalGoal.update({ where: { id }, data: { title: req.body.title, description: req.body.description, progress } }) });
}));

router.delete('/goals/:goalId', h(async (req, res) => {
  const id = intParam(req.params.goalId, 'goal');
  const goal = await prisma.appraisalGoal.findUnique({ where: { id } });
  if (!goal) throw new HttpError(404, 'Goal not found');
  if (!(await canAccessUser(req.user, goal.userId))) throw new HttpError(403, 'You do not have access to this goal');
  await prisma.appraisalGoal.delete({ where: { id } });
  res.json({ ok: true });
}));

router.get('/', h(async (req, res) => {
  const hr = await isHr(req.user);
  const ids = await teamIds(req.user);
  const where = req.query.scope === 'mine' ? { userId: req.user.id }
    : hr ? {} : { OR: [{ userId: req.user.id }, { managerId: req.user.id }, { userId: { in: ids || [] } }] };
  const rows = await prisma.appraisal.findMany({ where, orderBy: [{ state: 'asc' }, { deadline: 'asc' }], take: 200 });
  const people = await names(rows.flatMap((a) => [a.userId, a.managerId]));
  res.json({ appraisals: rows.map((a) => view(a, req.user, people)), canCreate: hr || (await teamIds(req.user)).length > 0 });
}));

router.post('/', h(async (req, res) => {
  required(req.body, ['userId', 'deadline']);
  const userId = intParam(req.body.userId, 'userId');
  if (userId === req.user.id) throw new HttpError(400, 'Someone else must start your appraisal');
  if (!(await isHr(req.user)) && !(await canAccessUser(req.user, userId))) throw new HttpError(403, 'This person is not on your team');
  const employee = await prisma.user.findUnique({ where: { id: userId } });
  if (!employee) throw new HttpError(404, 'Employee not found');
  const managerId = req.body.managerId ? Number(req.body.managerId) : await managerOf(employee);
  const { appraisal: tpl } = await getSettings();
  const a = await prisma.appraisal.create({
    data: { userId, managerId, deadline: toDbDate(dateParam(req.body.deadline)), state: 'PENDING', employeeFeedback: tpl.employeeTemplate, managerFeedback: tpl.managerTemplate, createdById: req.user.id },
  });
  await audit(req, { entity: 'Appraisal', entityId: a.id, action: 'appraisal.created', after: { userId, managerId } });
  await notify(userId, { type: 'appraisal.requested', title: 'Your appraisal has started', body: `Please complete your self-assessment by ${req.body.deadline}.`, link: '/appraisals' });
  await notify(managerId, { type: 'appraisal.requested', title: `Appraisal to complete for ${employee.name}`, link: '/appraisals' });
  res.status(201).json({ id: a.id });
}));

router.patch('/:id', h(async (req, res) => {
  const a = await load(req);
  if (a.state !== 'PENDING') throw new HttpError(423, 'This appraisal is closed');
  const data = {};
  if (a.userId === req.user.id && req.body.employeeFeedback !== undefined) {
    if (a.employeeDone) throw new HttpError(423, 'You have already submitted this');
    data.employeeFeedback = req.body.employeeFeedback;
  }
  if (a.managerId === req.user.id && req.body.managerFeedback !== undefined) data.managerFeedback = req.body.managerFeedback;
  await prisma.appraisal.update({ where: { id: a.id }, data });
  res.json({ ok: true });
}));

router.post('/:id/submit', h(async (req, res) => {
  const a = await load(req);
  if (a.state !== 'PENDING') throw new HttpError(423, 'This appraisal is closed');
  const data = {};
  if (a.userId === req.user.id) data.employeeDone = true;
  else if (a.managerId === req.user.id) data.managerDone = true;
  else throw new HttpError(403, 'Only the employee or manager can submit');
  await prisma.appraisal.update({ where: { id: a.id }, data });
  const other = a.userId === req.user.id ? a.managerId : a.userId;
  await notify(other, { type: 'appraisal.submitted', title: `${req.user.name} submitted their appraisal feedback`, link: '/appraisals' });
  res.json({ ok: true });
}));

router.post('/:id/finish', h(async (req, res) => {
  const a = await load(req);
  if (a.managerId !== req.user.id && !(await isHr(req.user))) throw new HttpError(403, 'Only the manager can finish an appraisal');
  if (a.userId === req.user.id) throw new HttpError(403, 'You cannot finish your own appraisal');
  if (a.state !== 'PENDING') throw new HttpError(409, 'This appraisal is already closed');
  const rating = Number(req.body.rating);
  if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, 'Give a rating from 1 to 5');
  await prisma.appraisal.update({ where: { id: a.id }, data: { state: 'DONE', rating, managerDone: true } });
  await audit(req, { entity: 'Appraisal', entityId: a.id, action: 'appraisal.finished', after: { rating } });
  await notify(a.userId, { type: 'appraisal.done', title: 'Your appraisal is complete', link: '/appraisals' });
  res.json({ ok: true });
}));

router.post('/:id/cancel', h(async (req, res) => {
  const a = await load(req);
  if (a.managerId !== req.user.id && !(await isHr(req.user))) throw new HttpError(403, 'Only the manager or HR can cancel');
  await prisma.appraisal.update({ where: { id: a.id }, data: { state: 'CANCELLED' } });
  res.json({ ok: true });
}));

router.post('/:id/reopen', h(async (req, res) => {
  const a = await load(req);
  if (a.managerId !== req.user.id && !(await isHr(req.user))) throw new HttpError(403, 'Only the manager or HR can reopen');
  await prisma.appraisal.update({ where: { id: a.id }, data: { state: 'PENDING', managerDone: false, employeeDone: false, rating: null } });
  res.json({ ok: true });
}));

module.exports = router;
