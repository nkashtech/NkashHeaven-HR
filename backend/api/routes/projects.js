const express = require('express');
const prisma = require('../../lib/prisma');
const { authenticate, requirePerm } = require('../middleware/auth');
const { HttpError, h, required, intParam, dateParam } = require('../middleware/validation');
const { can } = require('../../lib/permissions');
const { audit } = require('../../lib/audit');
const { notify } = require('../../lib/notify');
const { getSettings } = require('../../lib/settings');
const { getConfig, saveConfig } = require('../../lib/integrations');
const clickup = require('../../lib/clickup');
const { toDbDate, fromDbDate, today, addDays, mondayOf, round2 } = require('../../lib/time');

const router = express.Router();
router.use(authenticate);
router.use(requirePerm('module.projects', 'projects.manage'));

const DEFAULT_STAGES = [['To Do', false], ['In Progress', false], ['Review', false], ['Done', true]];
const HEALTH = ['on_track', 'at_risk', 'off_track', 'on_hold', 'done'];
const optDate = (v) => (v ? toDbDate(dateParam(v)) : null);
const optInt = (v) => (v ? Number(v) : null);
const person = { select: { id: true, name: true, profile: { select: { photoFileId: true } } } };
const personView = (u) => (u ? { id: u.id, name: u.name, photoFileId: u.profile?.photoFileId || null } : null);

async function canEditProject(user, project) {
  return project.managerId === user.id || project.createdById === user.id || can(user, 'projects.manage');
}

async function ensureEdit(req, project) {
  if (!(await canEditProject(req.user, project))) throw new HttpError(403, 'Only the project manager can change this');
}

async function track(entity, entityId, authorId, body) {
  await prisma.chatterEntry.create({ data: { entity, entityId, authorId, kind: 'TRACKING', body } });
}

// Project cards: task counts, hours against the budget, and the next activity.
async function cards(where, userId) {
  const projects = await prisma.project.findMany({
    where, include: { manager: person, stage: true, favorites: { where: { userId } } }, orderBy: [{ name: 'asc' }],
  });
  const ids = projects.map((p) => p.id);
  const [tasks, hours, activities] = await Promise.all([
    prisma.task.findMany({ where: { projectId: { in: ids }, active: true }, select: { projectId: true, stage: { select: { isDone: true } } } }),
    prisma.timesheetLine.groupBy({ by: ['projectId'], where: { projectId: { in: ids } }, _sum: { hours: true } }),
    prisma.activity.findMany({ where: { entity: 'project', entityId: { in: ids }, doneAt: null }, orderBy: { dueDate: 'asc' } }),
  ]);
  const logged = new Map(hours.map((x) => [x.projectId, x._sum.hours || 0]));
  return projects.map((p) => {
    const mine = tasks.filter((t) => t.projectId === p.id);
    const spent = round2(logged.get(p.id) || 0);
    const next = activities.find((a) => a.entityId === p.id);
    return {
      id: p.id, name: p.name, stageId: p.stageId, stage: p.stage?.name || null, manager: personView(p.manager), taskLabel: p.taskLabel, health: p.health, customer: p.customer, tags: p.tags || [],
      plannedStart: p.plannedStart ? fromDbDate(p.plannedStart) : null, plannedEnd: p.plannedEnd ? fromDbDate(p.plannedEnd) : null, allocatedHours: p.allocatedHours,
      hoursSpent: spent, remainingHours: p.allocatedHours ? round2(p.allocatedHours - spent) : null, tasksTotal: mine.length, tasksDone: mine.filter((t) => t.stage?.isDone).length,
      favorite: p.favorites.length > 0, nextActivity: next ? { summary: next.summary, dueDate: fromDbDate(next.dueDate) } : null, active: p.active,
    };
  });
}

// Project stages (the kanban columns)
router.get('/stages', h(async (req, res) => {
  res.json({ stages: await prisma.projectStage.findMany({ orderBy: [{ sequence: 'asc' }, { id: 'asc' }] }) });
}));

router.post('/stages', requirePerm('projects.manage'), h(async (req, res) => {
  required(req.body, ['name']);
  const last = await prisma.projectStage.aggregate({ _max: { sequence: true } });
  res.status(201).json({ stage: await prisma.projectStage.create({ data: { name: req.body.name, sequence: (last._max.sequence || 0) + 1 } }) });
}));

router.patch('/stages/:id', requirePerm('projects.manage'), h(async (req, res) => {
  res.json({ stage: await prisma.projectStage.update({ where: { id: intParam(req.params.id) }, data: { name: req.body.name, sequence: req.body.sequence, folded: req.body.folded } }) });
}));

router.delete('/stages/:id', requirePerm('projects.manage'), h(async (req, res) => {
  const id = intParam(req.params.id);
  if (await prisma.project.count({ where: { stageId: id } })) throw new HttpError(409, 'Move the projects out of this stage first');
  await prisma.projectStage.delete({ where: { id } });
  res.json({ ok: true });
}));

router.get('/dashboard', h(async (req, res) => {
  const { timezone: tz } = await getSettings();
  const day = today(tz);
  const week = mondayOf(day);
  const projects = await cards({ active: true }, req.user.id);
  const openWhere = { active: true, project: { active: true }, OR: [{ stageId: null }, { stage: { isDone: false } }] };
  const [openTasks, overdue, myTasks, myActivities, weekHours, topUsers] = await Promise.all([
    prisma.task.count({ where: openWhere }),
    prisma.task.count({ where: { ...openWhere, deadline: { lt: toDbDate(day) } } }),
    prisma.task.count({ where: { ...openWhere, assignees: { some: { userId: req.user.id } } } }),
    prisma.activity.findMany({ where: { assigneeId: req.user.id, doneAt: null }, orderBy: { dueDate: 'asc' }, take: 8 }),
    prisma.timesheetLine.aggregate({ where: { date: { gte: toDbDate(week) } }, _sum: { hours: true } }),
    prisma.timesheetLine.groupBy({ by: ['projectId'], where: { date: { gte: toDbDate(week) } }, _sum: { hours: true }, orderBy: { _sum: { hours: 'desc' } }, take: 6 }),
  ]);
  const health = Object.fromEntries(HEALTH.map((k) => [k, projects.filter((p) => p.health === k).length]));
  const names = new Map(projects.map((p) => [p.id, p.name]));
  res.json({
    projects: projects.length, openTasks, overdue, myTasks, health, hoursThisWeek: round2(weekHours._sum.hours || 0),
    overBudget: projects.filter((p) => p.remainingHours !== null && p.remainingHours < 0).map((p) => ({ id: p.id, name: p.name, remainingHours: p.remainingHours })),
    hoursByProject: topUsers.map((x) => ({ name: names.get(x.projectId) || 'Archived', hours: round2(x._sum.hours || 0) })),
    activities: myActivities.map((a) => ({ id: a.id, entity: a.entity, entityId: a.entityId, summary: a.summary, dueDate: fromDbDate(a.dueDate) })),
  });
}));

router.get('/reporting', h(async (req, res) => {
  const { timezone: tz } = await getSettings();
  const to = req.query.to ? dateParam(req.query.to, 'to') : today(tz);
  const from = req.query.from ? dateParam(req.query.from, 'from') : addDays(to, -29);
  const range = { gte: toDbDate(from), lte: toDbDate(to) };
  const [byProject, byUser, taskStages] = await Promise.all([
    prisma.timesheetLine.groupBy({ by: ['projectId'], where: { date: range }, _sum: { hours: true }, orderBy: { _sum: { hours: 'desc' } }, take: 20 }),
    prisma.timesheetLine.groupBy({ by: ['userId'], where: { date: range }, _sum: { hours: true }, orderBy: { _sum: { hours: 'desc' } }, take: 20 }),
    prisma.task.findMany({ where: { active: true, project: { active: true } }, select: { stage: { select: { name: true, isDone: true } } } }),
  ]);
  const [projects, users] = await Promise.all([
    prisma.project.findMany({ where: { id: { in: byProject.map((x) => x.projectId) } }, select: { id: true, name: true, allocatedHours: true } }),
    prisma.user.findMany({ where: { id: { in: byUser.map((x) => x.userId) } }, select: { id: true, name: true } }),
  ]);
  const stages = {};
  taskStages.forEach((t) => { const k = t.stage?.name || 'No stage'; stages[k] = (stages[k] || 0) + 1; });
  res.json({
    from, to,
    byProject: byProject.map((x) => { const p = projects.find((q) => q.id === x.projectId); return { id: x.projectId, name: p?.name, hours: round2(x._sum.hours || 0), allocated: p?.allocatedHours || 0 }; }),
    byUser: byUser.map((x) => ({ name: users.find((u) => u.id === x.userId)?.name, hours: round2(x._sum.hours || 0) })),
    tasksByStage: Object.entries(stages).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  });
}));

const taskInclude = {
  assignees: { include: { user: person } }, stage: true, project: { select: { id: true, name: true, managerId: true, createdById: true } },
  _count: { select: { subtasks: true } }, lines: { select: { hours: true } },
};
const taskView = (t) => ({
  id: t.id, name: t.name, projectId: t.projectId, project: t.project?.name, stageId: t.stageId, stage: t.stage?.name || null, isDone: Boolean(t.stage?.isDone), parentId: t.parentId,
  priority: t.priority, deadline: t.deadline ? fromDbDate(t.deadline) : null, plannedHours: t.plannedHours, tags: t.tags || [], description: t.description,
  assignees: t.assignees.map((a) => personView(a.user)), subtasks: t._count.subtasks, hoursSpent: round2(t.lines.reduce((s, l) => s + l.hours, 0)), imported: Boolean(t.externalId),
});

// All tasks, or just mine (the Tasks menu)
router.get('/tasks', h(async (req, res) => {
  const where = { active: true, project: { active: true } };
  if (req.query.mine === 'true') where.assignees = { some: { userId: req.user.id } };
  if (req.query.projectId) where.projectId = Number(req.query.projectId);
  if (req.query.q) where.name = { contains: String(req.query.q) };
  if (req.query.open === 'true') where.OR = [{ stageId: null }, { stage: { isDone: false } }];
  const tasks = await prisma.task.findMany({ where, include: taskInclude, orderBy: [{ priority: 'desc' }, { deadline: 'asc' }, { id: 'desc' }], take: 300 });
  res.json({ tasks: tasks.map(taskView) });
}));

router.get('/tasks/:taskId', h(async (req, res) => {
  const id = intParam(req.params.taskId, 'task');
  const task = await prisma.task.findUnique({ where: { id }, include: taskInclude });
  if (!task) throw new HttpError(404, 'Task not found');
  const subtasks = await prisma.task.findMany({ where: { parentId: id, active: true }, include: taskInclude });
  res.json({ task: { ...taskView(task), subtaskList: subtasks.map(taskView) }, stages: await prisma.taskStage.findMany({ where: { projectId: task.projectId }, orderBy: { sequence: 'asc' } }) });
}));

async function setAssignees(req, task, ids, projectName) {
  const before = (await prisma.taskAssignee.findMany({ where: { taskId: task.id } })).map((a) => a.userId);
  const next = [...new Set(ids.map(Number))];
  await prisma.taskAssignee.deleteMany({ where: { taskId: task.id } });
  if (next.length) await prisma.taskAssignee.createMany({ data: next.map((userId) => ({ taskId: task.id, userId })) });
  const added = next.filter((id) => !before.includes(id) && id !== req.user.id);
  await notify(added, { type: 'tagged.task', title: `${req.user.name} assigned you a task`, body: `${projectName}: ${task.name}`, link: `/projects/${task.projectId}/tasks?task=${task.id}` });
}

router.patch('/tasks/:taskId', h(async (req, res) => {
  const id = intParam(req.params.taskId, 'task');
  const task = await prisma.task.findUnique({ where: { id }, include: { project: true, stage: true } });
  if (!task) throw new HttpError(404, 'Task not found');
  const b = req.body;
  const data = {
    name: b.name, description: b.description, priority: b.priority, plannedHours: b.plannedHours === undefined ? undefined : Number(b.plannedHours) || 0, tags: b.tags, active: b.active,
    stageId: b.stageId === undefined ? undefined : optInt(b.stageId), deadline: b.deadline === undefined ? undefined : optDate(b.deadline),
  };
  await prisma.task.update({ where: { id }, data });
  if (b.assigneeIds) await setAssignees(req, task, b.assigneeIds, task.project.name);
  if (data.stageId !== undefined && data.stageId !== task.stageId) {
    const stage = data.stageId ? await prisma.taskStage.findUnique({ where: { id: data.stageId } }) : null;
    await track('task', id, req.user.id, `Stage: ${task.stage?.name || 'None'} → ${stage?.name || 'None'}`);
  }
  res.json({ task: taskView(await prisma.task.findUnique({ where: { id }, include: taskInclude })) });
}));

// ClickUp import (needs projects.manage)
router.get('/import/clickup', requirePerm('projects.manage'), h(async (req, res) => {
  const { apiToken } = await getConfig('clickup');
  if (!apiToken) return res.json({ connected: false, lists: [] });
  try {
    return res.json({ connected: true, lists: await clickup.listHierarchy(apiToken) });
  } catch (err) {
    throw new HttpError(502, err.message);
  }
}));

router.post('/import/clickup/token', requirePerm('projects.manage'), h(async (req, res) => {
  required(req.body, ['apiToken']);
  await clickup.listHierarchy(req.body.apiToken).catch((err) => { throw new HttpError(400, err.message); });
  await saveConfig('clickup', { apiToken: req.body.apiToken });
  await audit(req, { entity: 'Integration', entityId: 'clickup', action: 'integration.updated' });
  res.json({ ok: true });
}));

router.post('/import/clickup', requirePerm('projects.manage'), h(async (req, res) => {
  required(req.body, ['listIds']);
  const { apiToken } = await getConfig('clickup');
  if (!apiToken) throw new HttpError(400, 'Connect ClickUp first');
  const lists = await clickup.listHierarchy(apiToken);
  const results = [];
  for (const id of req.body.listIds.map(String)) {
    const list = lists.find((l) => String(l.id) === id);
    if (!list) continue;
    try {
      results.push(await clickup.importList(apiToken, list, { stageId: optInt(req.body.stageId), actorId: req.user.id }));
    } catch (err) {
      results.push({ project: { name: list.name }, error: err.message });
    }
  }
  await audit(req, { entity: 'Project', action: 'project.imported_clickup', after: { lists: results.length, tasks: results.reduce((s, r) => s + (r.tasks || 0), 0) } });
  res.json({ results });
}));

router.post('/import/csv', requirePerm('projects.manage'), h(async (req, res) => {
  required(req.body, ['csv', 'projectName']);
  try {
    const result = await clickup.importCsv({ csv: req.body.csv, projectName: req.body.projectName, stageId: optInt(req.body.stageId), actorId: req.user.id });
    await audit(req, { entity: 'Project', entityId: result.project.id, action: 'project.imported_csv', after: { tasks: result.tasks } });
    res.json({ result });
  } catch (err) {
    throw new HttpError(400, err.message);
  }
}));

// Risk, Issue & Change register, across projects
router.get('/risks', h(async (req, res) => {
  const where = { kind: req.query.kind || undefined, status: req.query.status || undefined, projectId: req.query.projectId ? Number(req.query.projectId) : undefined };
  const rows = await prisma.riskItem.findMany({ where, include: { project: { select: { id: true, name: true } } }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 200 });
  const owners = new Map((await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.ownerId).filter(Boolean) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  res.json({ items: rows.map((r) => ({ ...r, dueDate: r.dueDate ? fromDbDate(r.dueDate) : null, ownerName: owners.get(r.ownerId) || null })) });
}));

router.patch('/risks/:riskId', h(async (req, res) => {
  const id = intParam(req.params.riskId, 'risk');
  const b = req.body;
  res.json({ item: await prisma.riskItem.update({ where: { id }, data: { title: b.title, description: b.description, severity: b.severity, status: b.status, ownerId: b.ownerId === undefined ? undefined : optInt(b.ownerId), dueDate: b.dueDate === undefined ? undefined : optDate(b.dueDate) } }) });
}));

// Chatter: works on projects and tasks
const ENTITIES = ['project', 'task'];
const entityParam = (e) => { if (!ENTITIES.includes(e)) throw new HttpError(404, 'Unknown record type'); return e; };

router.get('/chatter/:entity/:id', h(async (req, res) => {
  const entity = entityParam(req.params.entity);
  const entityId = intParam(req.params.id);
  const [entries, activities, followers] = await Promise.all([
    prisma.chatterEntry.findMany({ where: { entity, entityId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.activity.findMany({ where: { entity, entityId, doneAt: null }, orderBy: { dueDate: 'asc' } }),
    prisma.follower.findMany({ where: { entity, entityId } }),
  ]);
  const ids = [...new Set([...entries.map((e) => e.authorId), ...activities.map((a) => a.assigneeId)].filter(Boolean))];
  const names = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  res.json({
    entries: entries.map((e) => ({ ...e, authorName: names.get(e.authorId) || 'System' })),
    activities: activities.map((a) => ({ ...a, dueDate: fromDbDate(a.dueDate), assigneeName: names.get(a.assigneeId) })),
    followers: followers.length, following: followers.some((f) => f.userId === req.user.id),
  });
}));

router.post('/chatter/:entity/:id', h(async (req, res) => {
  const entity = entityParam(req.params.entity);
  const entityId = intParam(req.params.id);
  required(req.body, ['body']);
  const kind = req.body.kind === 'NOTE' ? 'NOTE' : 'MESSAGE';
  const entry = await prisma.chatterEntry.create({ data: { entity, entityId, authorId: req.user.id, kind, body: String(req.body.body).slice(0, 5000) } });
  if (kind === 'MESSAGE') {
    const followers = await prisma.follower.findMany({ where: { entity, entityId, userId: { not: req.user.id } } });
    await notify(followers.map((f) => f.userId), { type: 'tagged.chatter', title: `${req.user.name} posted on a ${entity} you follow`, body: entry.body.slice(0, 200), link: entity === 'project' ? `/projects/${entityId}` : '/tasks' });
  }
  res.status(201).json({ entry });
}));

router.post('/chatter/:entity/:id/follow', h(async (req, res) => {
  const entity = entityParam(req.params.entity);
  const key = { entity, entityId: intParam(req.params.id), userId: req.user.id };
  const existing = await prisma.follower.findUnique({ where: { entity_entityId_userId: key } });
  if (existing) await prisma.follower.delete({ where: { entity_entityId_userId: key } });
  else await prisma.follower.create({ data: key });
  res.json({ following: !existing });
}));

router.post('/chatter/:entity/:id/activities', h(async (req, res) => {
  const entity = entityParam(req.params.entity);
  const entityId = intParam(req.params.id);
  required(req.body, ['summary', 'dueDate', 'assigneeId']);
  const activity = await prisma.activity.create({ data: { entity, entityId, summary: req.body.summary, dueDate: toDbDate(dateParam(req.body.dueDate)), assigneeId: Number(req.body.assigneeId), createdById: req.user.id } });
  if (activity.assigneeId !== req.user.id) {
    await notify(activity.assigneeId, { type: 'tagged.activity', title: `${req.user.name} scheduled an activity for you`, body: activity.summary, link: entity === 'project' ? `/projects/${entityId}` : '/tasks' });
  }
  res.status(201).json({ activity });
}));

router.post('/activities/:activityId/done', h(async (req, res) => {
  const id = intParam(req.params.activityId, 'activity');
  const activity = await prisma.activity.update({ where: { id }, data: { doneAt: new Date() } });
  await track(activity.entity, activity.entityId, req.user.id, `Activity done: ${activity.summary}`);
  res.json({ ok: true });
}));

router.patch('/task-stages/:stageId', h(async (req, res) => {
  const id = intParam(req.params.stageId, 'stage');
  const stage = await prisma.taskStage.findUnique({ where: { id }, include: { project: true } });
  if (!stage) throw new HttpError(404, 'Stage not found');
  await ensureEdit(req, stage.project);
  res.json({ stage: await prisma.taskStage.update({ where: { id }, data: { name: req.body.name, sequence: req.body.sequence, isDone: req.body.isDone } }) });
}));

router.delete('/task-stages/:stageId', h(async (req, res) => {
  const id = intParam(req.params.stageId, 'stage');
  const stage = await prisma.taskStage.findUnique({ where: { id }, include: { project: true } });
  if (!stage) throw new HttpError(404, 'Stage not found');
  await ensureEdit(req, stage.project);
  if (await prisma.task.count({ where: { stageId: id, active: true } })) throw new HttpError(409, 'Move the tasks out of this stage first');
  await prisma.task.updateMany({ where: { stageId: id }, data: { stageId: null } });
  await prisma.taskStage.delete({ where: { id } });
  res.json({ ok: true });
}));

// Projects
router.get('/', h(async (req, res) => {
  const where = { active: req.query.archived === 'true' ? false : true };
  if (req.query.q) where.name = { contains: String(req.query.q) };
  if (req.query.mine === 'true') where.managerId = req.user.id;
  if (req.query.favorites === 'true') where.favorites = { some: { userId: req.user.id } };
  const [projects, stages] = await Promise.all([cards(where, req.user.id), prisma.projectStage.findMany({ orderBy: [{ sequence: 'asc' }, { id: 'asc' }] })]);
  res.json({ projects, stages, canCreate: await can(req.user, 'projects.create'), canManage: await can(req.user, 'projects.manage') });
}));

router.post('/', requirePerm('projects.create'), h(async (req, res) => {
  required(req.body, ['name']);
  const b = req.body;
  const first = b.stageId ? null : await prisma.projectStage.findFirst({ orderBy: [{ sequence: 'asc' }, { id: 'asc' }] });
  const project = await prisma.project.create({
    data: {
      name: String(b.name).trim(), stageId: optInt(b.stageId) || first?.id || null, managerId: optInt(b.managerId) || req.user.id, createdById: req.user.id, departmentId: optInt(b.departmentId),
      taskLabel: b.taskLabel || 'Tasks', customer: b.customer || null,
      taskStages: { create: DEFAULT_STAGES.map(([name, isDone], sequence) => ({ name, isDone, sequence })) },
    },
  });
  await track('project', project.id, req.user.id, 'Project created');
  await prisma.follower.create({ data: { entity: 'project', entityId: project.id, userId: req.user.id } });
  await audit(req, { entity: 'Project', entityId: project.id, action: 'project.created', after: { name: project.name } });
  res.status(201).json({ project });
}));

router.get('/:id', h(async (req, res) => {
  const id = intParam(req.params.id);
  const [card] = await cards({ id }, req.user.id);
  if (!card) throw new HttpError(404, 'Project not found');
  const project = await prisma.project.findUnique({ where: { id }, include: { department: { select: { id: true, name: true } } } });
  const [stages, taskStages, risks] = await Promise.all([
    prisma.projectStage.findMany({ orderBy: [{ sequence: 'asc' }, { id: 'asc' }] }),
    prisma.taskStage.findMany({ where: { projectId: id }, orderBy: { sequence: 'asc' } }),
    prisma.riskItem.findMany({ where: { projectId: id }, orderBy: { createdAt: 'desc' } }),
  ]);
  const hoursBy = await prisma.timesheetLine.groupBy({ by: ['userId'], where: { projectId: id }, _sum: { hours: true }, orderBy: { _sum: { hours: 'desc' } }, take: 8 });
  const users = await prisma.user.findMany({ where: { id: { in: [...hoursBy.map((x) => x.userId), ...risks.map((r) => r.ownerId).filter(Boolean)] } }, select: { id: true, name: true } });
  const nameOf = (uid) => users.find((u) => u.id === uid)?.name;
  res.json({
    project: { ...card, description: project.description, department: project.department, billable: project.billable, imported: Boolean(project.externalId) },
    stages, taskStages, canEdit: await canEditProject(req.user, project),
    risks: risks.map((r) => ({ ...r, dueDate: r.dueDate ? fromDbDate(r.dueDate) : null, ownerName: nameOf(r.ownerId) || null })),
    team: hoursBy.map((x) => ({ name: nameOf(x.userId), hours: round2(x._sum.hours || 0) })),
  });
}));

router.patch('/:id', h(async (req, res) => {
  const id = intParam(req.params.id);
  const project = await prisma.project.findUnique({ where: { id }, include: { stage: true } });
  if (!project) throw new HttpError(404, 'Project not found');
  await ensureEdit(req, project);
  const b = req.body;
  if (b.health && !HEALTH.includes(b.health)) throw new HttpError(400, 'Unknown status');
  const data = {
    name: b.name, description: b.description, taskLabel: b.taskLabel, health: b.health, customer: b.customer, tags: b.tags, billable: b.billable, active: b.active,
    allocatedHours: b.allocatedHours === undefined ? undefined : Number(b.allocatedHours) || 0, stageId: b.stageId === undefined ? undefined : optInt(b.stageId),
    managerId: b.managerId === undefined ? undefined : optInt(b.managerId), departmentId: b.departmentId === undefined ? undefined : optInt(b.departmentId),
    plannedStart: b.plannedStart === undefined ? undefined : optDate(b.plannedStart), plannedEnd: b.plannedEnd === undefined ? undefined : optDate(b.plannedEnd),
  };
  if (data.plannedStart && data.plannedEnd && data.plannedEnd < data.plannedStart) throw new HttpError(400, 'The end date is before the start date');
  await prisma.project.update({ where: { id }, data });
  if (data.stageId !== undefined && data.stageId !== project.stageId) {
    const stage = data.stageId ? await prisma.projectStage.findUnique({ where: { id: data.stageId } }) : null;
    await track('project', id, req.user.id, `Stage: ${project.stage?.name || 'None'} → ${stage?.name || 'None'}`);
  }
  if (data.managerId && data.managerId !== project.managerId && data.managerId !== req.user.id) {
    await notify(data.managerId, { type: 'tagged.project', title: `${req.user.name} made you manager of ${project.name}`, link: `/projects/${id}` });
  }
  if (b.health && b.health !== project.health) await track('project', id, req.user.id, `Status: ${project.health} → ${b.health}`);
  res.json({ ok: true });
}));

router.post('/:id/favorite', h(async (req, res) => {
  const key = { userId: req.user.id, projectId: intParam(req.params.id) };
  const found = await prisma.projectFavorite.findUnique({ where: { userId_projectId: key } });
  if (found) await prisma.projectFavorite.delete({ where: { userId_projectId: key } });
  else await prisma.projectFavorite.create({ data: key });
  res.json({ favorite: !found });
}));

router.post('/:id/tasks', h(async (req, res) => {
  const projectId = intParam(req.params.id);
  required(req.body, ['name']);
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project?.active) throw new HttpError(404, 'Project not found');
  const b = req.body;
  const first = b.stageId ? null : await prisma.taskStage.findFirst({ where: { projectId }, orderBy: { sequence: 'asc' } });
  const task = await prisma.task.create({
    data: {
      projectId, name: b.name, stageId: optInt(b.stageId) || first?.id || null, parentId: optInt(b.parentId), description: b.description || null, deadline: optDate(b.deadline),
      plannedHours: Number(b.plannedHours) || 0, priority: Boolean(b.priority), createdById: req.user.id,
    },
  });
  if (b.assigneeIds?.length) await setAssignees(req, task, b.assigneeIds, project.name);
  await track('task', task.id, req.user.id, 'Task created');
  res.status(201).json({ task });
}));

router.post('/:id/stages', h(async (req, res) => {
  const projectId = intParam(req.params.id);
  required(req.body, ['name']);
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new HttpError(404, 'Project not found');
  await ensureEdit(req, project);
  const last = await prisma.taskStage.aggregate({ where: { projectId }, _max: { sequence: true } });
  res.status(201).json({ stage: await prisma.taskStage.create({ data: { projectId, name: req.body.name, sequence: (last._max.sequence ?? -1) + 1, isDone: Boolean(req.body.isDone) } }) });
}));

router.post('/:id/risks', h(async (req, res) => {
  const projectId = intParam(req.params.id);
  required(req.body, ['kind', 'title']);
  if (!['RISK', 'ISSUE', 'CHANGE'].includes(req.body.kind)) throw new HttpError(400, 'Unknown register type');
  const b = req.body;
  const item = await prisma.riskItem.create({ data: { projectId, kind: b.kind, title: b.title, description: b.description || null, severity: b.severity || 'MEDIUM', ownerId: optInt(b.ownerId), dueDate: optDate(b.dueDate), createdById: req.user.id } });
  await track('project', projectId, req.user.id, `${b.kind.toLowerCase()} logged: ${b.title}`);
  res.status(201).json({ item });
}));

module.exports = router;
