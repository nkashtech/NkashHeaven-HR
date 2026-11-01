const express = require('express');
const prisma = require('../../lib/prisma');
const { authenticate, requirePerm } = require('../middleware/auth');
const { HttpError, h, intParam } = require('../middleware/validation');
const { getSettings } = require('../../lib/settings');
const { notify } = require('../../lib/notify');
const { presenceFor, botMessage } = require('../../lib/chat');
const { toDbDate, fromDbDate, today, addDays, yearOf } = require('../../lib/time');

const router = express.Router();
router.use(authenticate);
router.use(requirePerm('module.people', 'users.manage'));

const includeBasics = { department: { select: { id: true, name: true } }, profile: true };
const display = (u) => u.name;

function nextOccurrence(monthDay, day) {
  const year = yearOf(day);
  const thisYear = `${year}-${monthDay}`;
  return thisYear >= day ? thisYear : `${year + 1}-${monthDay}`;
}

// BDY-01 / BDY-03: month and day only, never the year; hidden birthdays never leave the server.
router.get('/celebrations', h(async (req, res) => {
  const { timezone: tz } = await getSettings();
  const day = today(tz);
  const horizon = addDays(day, 30);
  const users = await prisma.user.findMany({ where: { active: true, role: { not: 'SUPER_ADMIN' } }, include: includeBasics });
  const year = yearOf(day);
  const wishes = await prisma.wish.groupBy({ by: ['toId'], where: { year }, _count: { _all: true } });
  const wishCount = new Map(wishes.map((w) => [w.toId, w._count._all]));
  const mine = await prisma.wish.findMany({ where: { fromId: req.user.id, year }, select: { toId: true } });
  const wished = new Set(mine.map((w) => w.toId));

  const birthdays = users
    .filter((u) => u.showBirthday && u.profile?.birthDate)
    .map((u) => ({ u, on: nextOccurrence(fromDbDate(u.profile.birthDate).slice(5), day) }))
    .filter(({ on }) => on <= horizon)
    .sort((a, b) => a.on.localeCompare(b.on));

  const person = (u) => ({ id: u.id, name: display(u), jobTitle: u.jobTitle, department: u.department?.name || null, photoFileId: u.profile?.photoFileId || null });
  const startYears = (u) => yearOf(day) - yearOf(fromDbDate(u.startDate));
  const today_ = birthdays.filter((b) => b.on === day).map(({ u }) => ({ ...person(u), wishes: wishCount.get(u.id) || 0, wished: wished.has(u.id), years: startYears(u) }));
  const upcoming = birthdays.filter((b) => b.on !== day).map(({ u, on }) => ({ ...person(u), on }));
  const anniversaries = users
    .map((u) => ({ u, on: nextOccurrence(fromDbDate(u.startDate).slice(5), day) }))
    .filter(({ u, on }) => on <= horizon && yearOf(on) > yearOf(fromDbDate(u.startDate)))
    .sort((a, b) => a.on.localeCompare(b.on))
    .map(({ u, on }) => ({ ...person(u), on, years: yearOf(on) - yearOf(fromDbDate(u.startDate)) }));
  const joiners = users
    .filter((u) => { const s = fromDbDate(u.startDate); return s >= addDays(day, -30) && s <= horizon; })
    .sort((a, b) => b.startDate - a.startDate)
    .map((u) => ({ ...person(u), startDate: fromDbDate(u.startDate), upcoming: fromDbDate(u.startDate) > day }));
  res.json({ today: today_, upcoming, anniversaries, joiners });
}));

// BDY-02: one wish per person per year.
router.post('/:id/wish', h(async (req, res) => {
  const toId = intParam(req.params.id);
  if (toId === req.user.id) throw new HttpError(400, 'You cannot wish yourself');
  const { timezone: tz } = await getSettings();
  const year = yearOf(today(tz));
  const target = await prisma.user.findUnique({ where: { id: toId } });
  if (!target?.active) throw new HttpError(404, 'Person not found');
  try {
    await prisma.wish.create({ data: { fromId: req.user.id, toId, year, message: req.body.message ? String(req.body.message).slice(0, 500) : null } });
  } catch (err) {
    if (err.code === 'P2002') throw new HttpError(409, 'You have already sent your wishes this year');
    throw err;
  }
  await notify(toId, { type: 'birthday.wish', title: `${req.user.name} sent you birthday wishes`, body: req.body.message || null, link: '/' });
  await botMessage(toId, `${req.user.name} wished you a happy birthday${req.body.message ? `: "${req.body.message}"` : '!'}`, '/people');
  res.status(201).json({ ok: true });
}));

router.get('/wishes', h(async (req, res) => {
  const { timezone: tz } = await getSettings();
  const rows = await prisma.wish.findMany({ where: { toId: req.user.id, year: yearOf(today(tz)) }, orderBy: { createdAt: 'desc' } });
  const from = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.fromId) } }, select: { id: true, name: true } });
  const names = new Map(from.map((u) => [u.id, u.name]));
  res.json({ wishes: rows.map((r) => ({ id: r.id, from: names.get(r.fromId), message: r.message, at: r.createdAt })) });
}));

router.get('/directory', h(async (req, res) => {
  const { q, departmentId } = req.query;
  const where = { active: true, role: { not: 'SUPER_ADMIN' }, departmentId: departmentId ? Number(departmentId) : undefined };
  if (q) where.OR = [{ name: { contains: q } }, { jobTitle: { contains: q } }];
  const users = await prisma.user.findMany({ where, include: { ...includeBasics, schedule: true }, orderBy: { name: 'asc' } });
  const presence = await presenceFor(users);
  res.json({
    people: users.map((u) => ({
      id: u.id, name: display(u), jobTitle: u.jobTitle, department: u.department?.name || null, departmentId: u.departmentId,
      phone: u.showPhone ? u.profile?.phone || null : null, photoFileId: u.profile?.photoFileId || null, presence: presence.get(u.id),
    })),
    departments: await prisma.department.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  });
}));

// Who this person is and who they work with (their team, or department peers when no team is set).
router.get('/:id', h(async (req, res) => {
  const id = intParam(req.params.id);
  const { timezone: tz } = await getSettings();
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      ...includeBasics, department: { select: { id: true, name: true, managerId: true } }, schedule: true, team: { include: { lead: { select: { id: true, name: true } } } },
      manager: { select: { id: true, name: true, jobTitle: true } },
      reports: { where: { active: true }, select: { id: true, name: true, jobTitle: true }, orderBy: { name: 'asc' } },
    },
  });
  if (!user || (!user.active && !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role))) throw new HttpError(404, 'Person not found');
  const peers = await prisma.user.findMany({
    where: { active: true, id: { not: id }, ...(user.teamId ? { teamId: user.teamId } : user.departmentId ? { departmentId: user.departmentId } : { id: -1 }) },
    include: { profile: true, schedule: true }, orderBy: { name: 'asc' }, take: 40,
  });
  const presence = await presenceFor([user, ...peers]);
  const since = toDbDate(addDays(today(tz), -60));
  const lines = await prisma.timesheetLine.findMany({ where: { userId: id, date: { gte: since }, hours: { gt: 0 } }, select: { projectId: true }, distinct: ['projectId'] });
  const tasks = await prisma.taskAssignee.findMany({ where: { userId: id, task: { active: true } }, select: { task: { select: { projectId: true } } } });
  const projectIds = [...new Set([...lines.map((l) => l.projectId), ...tasks.map((t) => t.task.projectId)])];
  const projects = await prisma.project.findMany({ where: { id: { in: projectIds }, active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 12 });
  // With no manager set, the department's manager is who they report to (the same fallback approvals use).
  const deptManagerId = user.department?.managerId;
  const manager = user.manager || (deptManagerId && deptManagerId !== id ? await prisma.user.findUnique({ where: { id: deptManagerId }, select: { id: true, name: true, jobTitle: true } }) : null);
  res.json({
    person: {
      id: user.id, name: display(user), jobTitle: user.jobTitle, email: user.email, phone: user.showPhone ? user.profile?.phone || null : null, photoFileId: user.profile?.photoFileId || null,
      department: user.department?.name || null, team: user.team ? { id: user.team.id, name: user.team.name, lead: user.team.lead } : null,
      manager, managerId: user.managerId, startDate: fromDbDate(user.startDate), presence: presence.get(id),
      directReports: user.reports,
      worksWith: peers.map((p) => ({ id: p.id, name: display(p), jobTitle: p.jobTitle, photoFileId: p.profile?.photoFileId || null, presence: presence.get(p.id) })),
      worksWithLabel: user.team ? user.team.name : user.department?.name || null, projects,
    },
  });
}));

module.exports = router;
