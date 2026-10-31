const express = require('express');
const prisma = require('../../lib/prisma');
const { authenticate, requirePerm } = require('../middleware/auth');
const { h } = require('../middleware/validation');
const { teamIds, isAdmin } = require('../../lib/access');
const { pendingFor } = require('./leave');
const { pendingWeeks } = require('./timesheets');
const { fromDbDate, localTime, today, toDbDate, addDays, mondayOf, round2 } = require('../../lib/time');
const { getSettings } = require('../../lib/settings');

const router = express.Router();
router.use(authenticate);

// One inbox over leave, timesheets, auto check-outs and, for HR, missed days and profile requests.
router.get('/', requirePerm('leave.approve'), h(async (req, res) => {
  const { timezone: tz } = await getSettings();
  const [leave, timesheets] = await Promise.all([pendingFor(req.user), pendingWeeks(req.user)]);
  const ids = await teamIds(req.user);
  const auto = await prisma.attendance.findMany({
    where: { autoClosed: true, isEdited: false, reviewedAt: null, deletedAt: null, userId: ids === null ? { not: req.user.id } : { in: ids } },
    include: { user: { select: { name: true } } }, orderBy: { date: 'desc' }, take: 30,
  });
  let missedDays = [];
  let changeRequests = 0;
  if (isAdmin(req.user)) {
    const rows = await prisma.missedDayRequest.findMany({ where: { status: 'PENDING' }, orderBy: { date: 'asc' } });
    const names = new Map((await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    missedDays = rows.map((r) => ({ id: r.id, userId: r.userId, name: names.get(r.userId), date: fromDbDate(r.date), note: r.note }));
    changeRequests = await prisma.changeRequest.count({ where: { status: 'PENDING' } });
  }
  res.json({
    leave, timesheets, missedDays, changeRequests,
    autoCheckouts: auto.map((a) => ({ id: a.id, userId: a.userId, name: a.user.name, date: fromDbDate(a.date), checkIn: localTime(a.checkIn, tz), checkOut: localTime(a.checkOut, tz) })),
    total: leave.length + timesheets.length + auto.length + missedDays.length + changeRequests,
  });
}));

// Finished items a Manager or HR can reopen (BR-05).
router.get('/recent', requirePerm('leave.approve'), h(async (req, res) => {
  const { timezone: tz } = await getSettings();
  const ids = await teamIds(req.user);
  const people = ids === null ? { not: req.user.id } : { in: ids };
  const day = today(tz);
  const [lines, leave] = await Promise.all([
    prisma.timesheetLine.findMany({ where: { userId: people, state: 'VALIDATED', date: { gte: toDbDate(addDays(day, -56)) } }, include: { user: { select: { name: true } } } }),
    prisma.leaveRequest.findMany({ where: { userId: people, state: 'APPROVED', dateTo: { gte: toDbDate(day) } }, include: { user: { select: { name: true } }, leaveType: { select: { name: true } } }, orderBy: { dateFrom: 'asc' }, take: 50 }),
  ]);
  const weeks = new Map();
  lines.forEach((l) => {
    const week = mondayOf(fromDbDate(l.date));
    const key = `${l.userId}:${week}`;
    const w = weeks.get(key) || { userId: l.userId, name: l.user.name, week, hours: 0 };
    w.hours = round2(w.hours + l.hours);
    weeks.set(key, w);
  });
  return res.json({
    timesheets: [...weeks.values()].sort((a, b) => b.week.localeCompare(a.week)).slice(0, 40),
    leave: leave.map((r) => ({ id: r.id, name: r.user.name, type: r.leaveType.name, days: r.days, from: fromDbDate(r.dateFrom), to: fromDbDate(r.dateTo) })),
  });
}));

module.exports = router;
