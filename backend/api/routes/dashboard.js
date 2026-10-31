const express = require('express');
const prisma = require('../../lib/prisma');
const { authenticate, requirePerm } = require('../middleware/auth');
const { h } = require('../middleware/validation');
const { getSettings } = require('../../lib/settings');
const { teamIds } = require('../../lib/access');
const { boardFor, scheduleOf, shiftOn } = require('../../lib/attendance');
const leave = require('../../lib/leave');
const { pendingFor } = require('./leave');
const { pendingWeeks, gridFor } = require('./timesheets');
const { today, toDbDate, fromDbDate, addDays, mondayOf, eachDay, yearOf, round2 } = require('../../lib/time');

const router = express.Router();
router.use(authenticate);

const STATE_LABEL = { DRAFT: 'Draft', SUBMITTED: 'Submitted', PARTLY_APPROVED: 'Partly approved', APPROVED: 'Approved', REFUSED: 'Refused', CANCELLED: 'Cancelled' };

async function announcements() {
  const channel = await prisma.conversation.findFirst({ where: { channelKind: 'ANNOUNCEMENTS' } });
  if (!channel) return [];
  const rows = await prisma.message.findMany({ where: { conversationId: channel.id, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 3 });
  const senders = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.senderId).filter(Boolean) } }, select: { id: true, name: true } });
  const names = new Map(senders.map((s) => [s.id, s.name]));
  return rows.map((r) => ({ id: r.id, body: r.body, sender: names.get(r.senderId) || 'HR', at: r.createdAt }));
}

// Every signed-in person's own panels; role dashboards build on these.
router.get('/me', h(async (req, res) => {
  const { timezone: tz } = await getSettings();
  const day = today(tz);
  const week = mondayOf(day);
  const year = yearOf(day);
  const grid = await gridFor(req.user.id, week, tz);
  const byProject = new Map();
  grid.rows.forEach((r) => byProject.set(r.key, { project: r.project, task: r.task, hours: r.total }));
  const [balances, requests, lastValidated, ann] = await Promise.all([
    leave.balances(req.user.id, year),
    prisma.leaveRequest.findMany({ where: { userId: req.user.id }, include: { leaveType: true }, orderBy: { dateFrom: 'desc' }, take: 3 }),
    prisma.timesheetLine.findFirst({ where: { userId: req.user.id, state: 'VALIDATED' }, orderBy: { date: 'desc' } }),
    announcements(),
  ]);
  const items = requests.map((r) => ({
    id: `l${r.id}`, title: `${r.leaveType.name} · ${r.days} day${r.days === 1 ? '' : 's'}`, from: fromDbDate(r.dateFrom), to: fromDbDate(r.dateTo), state: r.state, label: STATE_LABEL[r.state],
  }));
  if (lastValidated) {
    const w = mondayOf(fromDbDate(lastValidated.date));
    items.push({ id: `t${w}`, title: 'Timesheet', from: w, to: addDays(w, 6), state: 'APPROVED', label: 'Validated' });
  }
  res.json({
    balances, requests: items, announcements: ann,
    timesheet: { logged: grid.totalLogged, attended: grid.totalAttended, scheduled: grid.scheduled, rows: [...byProject.values()], state: grid.state },
  });
}));

async function teamPeople(user) {
  const ids = await teamIds(user);
  return prisma.user.findMany({ where: { active: true, id: ids === null ? undefined : { in: ids }, role: { not: 'SUPER_ADMIN' } }, include: { schedule: true, department: { select: { name: true } } }, orderBy: { name: 'asc' } });
}

function counts(board) {
  const c = { in: 0, late: 0, leave: 0, absent: 0, out: 0, notYet: 0 };
  board.forEach((b) => {
    if (b.status === 'in') c.in += 1;
    if (b.status === 'late') { c.in += 1; c.late += 1; }
    if (b.status === 'leave') c.leave += 1;
    if (b.status === 'absent') c.absent += 1;
    if (b.status === 'out') c.out += 1;
    if (b.status === 'not_yet') c.notYet += 1;
  });
  return c;
}

// Share of past scheduled days in a week with a check-in or approved leave.
async function attendanceRate(people, weekStart, upTo) {
  const days = eachDay(weekStart, addDays(weekStart, 6)).filter((d) => d <= upTo);
  const ids = people.map((p) => p.id);
  const [records, approved, holidays] = await Promise.all([
    prisma.attendance.findMany({ where: { userId: { in: ids }, deletedAt: null, date: { gte: toDbDate(weekStart), lte: toDbDate(upTo) } }, select: { userId: true, date: true } }),
    prisma.leaveRequest.findMany({ where: { userId: { in: ids }, state: 'APPROVED', dateFrom: { lte: toDbDate(upTo) }, dateTo: { gte: toDbDate(weekStart) } } }),
    prisma.publicHoliday.findMany({ where: { date: { gte: toDbDate(weekStart), lte: toDbDate(upTo) } } }),
  ]);
  const present = new Set(records.map((r) => `${r.userId}:${fromDbDate(r.date)}`));
  approved.forEach((r) => eachDay(fromDbDate(r.dateFrom), fromDbDate(r.dateTo)).forEach((d) => present.add(`${r.userId}:${d}`)));
  const off = new Set(holidays.map((x) => fromDbDate(x.date)));
  let expected = 0;
  let hit = 0;
  for (const p of people) {
    const schedule = scheduleOf(p);
    for (const d of days) {
      if (!shiftOn(schedule, d) || off.has(d) || fromDbDate(p.startDate) > d) continue;
      expected += 1;
      if (present.has(`${p.id}:${d}`)) hit += 1;
    }
  }
  return expected ? Math.round((hit / expected) * 100) : null;
}

router.get('/team', requirePerm('reports.view'), h(async (req, res) => {
  const { timezone: tz } = await getSettings();
  const day = today(tz);
  const week = mondayOf(day);
  const people = await teamPeople(req.user);
  const ids = people.map((p) => p.id);
  const board = await boardFor(people);
  const c = counts(board);
  const [leaveInbox, weeks, missing] = await Promise.all([
    pendingFor(req.user), pendingWeeks(req.user),
    prisma.attendance.findMany({
      where: { userId: { in: ids }, autoClosed: true, isEdited: false, reviewedAt: null, deletedAt: null }, include: { user: { select: { name: true } } }, orderBy: { date: 'desc' }, take: 10,
    }),
  ]);
  const hoursByUser = await prisma.timesheetLine.groupBy({ by: ['userId'], where: { userId: { in: ids }, date: { gte: toDbDate(week), lte: toDbDate(addDays(week, 6)) } }, _sum: { hours: true } });
  const logged = new Map(hoursByUser.map((x) => [x.userId, x._sum.hours || 0]));
  const timesheets = people.map((p) => {
    const schedule = scheduleOf(p);
    const scheduled = eachDay(week, addDays(week, 6)).filter((d) => shiftOn(schedule, d)).length * schedule.hoursPerDay;
    return { id: p.id, name: p.name, logged: round2(logged.get(p.id) || 0), scheduled };
  });
  const totalScheduled = timesheets.reduce((s, t) => s + t.scheduled, 0);
  const totalLogged = round2(timesheets.reduce((s, t) => s + t.logged, 0));

  const projectHours = await prisma.timesheetLine.groupBy({ by: ['projectId'], where: { userId: { in: ids }, date: { gte: toDbDate(week), lte: toDbDate(addDays(week, 6)) } }, _sum: { hours: true }, orderBy: { _sum: { hours: 'desc' } }, take: 5 });
  const projects = await prisma.project.findMany({ where: { id: { in: projectHours.map((x) => x.projectId) } } });
  const rateWeeks = [];
  for (let i = 5; i >= 0; i -= 1) {
    const start = addDays(week, -7 * i);
    rateWeeks.push({ week: start, rate: await attendanceRate(people, start, i === 0 ? day : addDays(start, 6)) });
  }
  const overtime = await prisma.attendance.findMany({ where: { userId: { in: ids }, deletedAt: null, extraHours: { gt: 0 }, date: { gte: toDbDate(week) } }, include: { user: { select: { id: true, name: true } } } });
  const overtimeBy = new Map();
  overtime.forEach((o) => overtimeBy.set(o.userId, { name: o.user.name, hours: round2((overtimeBy.get(o.userId)?.hours || 0) + o.extraHours) }));
  const attended = await prisma.attendance.aggregate({ where: { userId: { in: ids }, deletedAt: null, date: { gte: toDbDate(week), lte: toDbDate(day) } }, _sum: { workedHours: true } });
  const lateMonth = await prisma.attendance.groupBy({ by: ['userId'], where: { userId: { in: ids }, deletedAt: null, lateMinutes: { gt: 0 }, date: { gte: toDbDate(addDays(day, -30)) } }, _count: { _all: true } });
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  const horizon = addDays(day, 13);
  const away = await prisma.leaveRequest.findMany({
    where: { userId: { in: ids }, state: { in: leave.LIVE_STATES }, dateFrom: { lte: toDbDate(horizon) }, dateTo: { gte: toDbDate(day) } }, include: { user: { select: { name: true } }, leaveType: { select: { name: true } } }, orderBy: { dateFrom: 'asc' },
  });
  const cover = eachDay(day, horizon).filter((d) => ![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())).map((date) => ({
    date, count: away.filter((a) => fromDbDate(a.dateFrom) <= date && fromDbDate(a.dateTo) >= date).length,
  }));

  res.json({
    headcount: people.length, board, counts: c, leaveInbox, timesheetInbox: weeks,
    missingCheckouts: missing.map((m) => ({ id: m.id, name: m.user.name, date: fromDbDate(m.date), checkIn: m.checkIn, checkOut: m.checkOut })),
    timesheets, totalLogged, totalScheduled,
    projects: projectHours.map((x) => ({ name: projects.find((p) => p.id === x.projectId)?.name, hours: round2(x._sum.hours || 0) })),
    attendanceTrend: rateWeeks,
    overtime: [...overtimeBy.values()].sort((a, b) => b.hours - a.hours),
    overtimeTotal: round2([...overtimeBy.values()].reduce((s, o) => s + o.hours, 0)),
    unlogged: Math.max(0, round2((attended._sum.workedHours || 0) - totalLogged)),
    lateRepeat: lateMonth.filter((l) => l._count._all >= 2).map((l) => ({ name: nameOf.get(l.userId), times: l._count._all })),
    upcomingLeave: away.slice(0, 6).map((a) => ({ id: a.id, name: a.user.name, type: a.leaveType.name, days: a.days, from: fromDbDate(a.dateFrom), to: fromDbDate(a.dateTo), pending: a.state !== 'APPROVED' })),
    cover,
  });
}));

router.get('/hr', requirePerm('users.manage'), h(async (req, res) => {
  const { timezone: tz, seats } = await getSettings();
  const day = today(tz);
  const week = mondayOf(day);
  const year = yearOf(day);
  const people = await prisma.user.findMany({ where: { active: true, role: { not: 'SUPER_ADMIN' } }, include: { schedule: true, department: { select: { name: true } }, profile: true } });
  const board = await boardFor(people);
  const c = counts(board);
  const monthAgo = addDays(day, -30);
  const [changes, requests, invites, leaveInbox, weeks, missed, editedCount, autoCount, allocs, takenRows] = await Promise.all([
    prisma.profileChange.findMany({ where: { seenAt: null }, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.changeRequest.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.user.findMany({ where: { inviteStatus: { in: ['SENT', 'OPENED', 'EXPIRED', 'BOUNCED'] }, active: true }, orderBy: { invitedAt: 'desc' }, take: 6 }),
    pendingFor(req.user), pendingWeeks(req.user),
    prisma.missedDayRequest.findMany({ where: { status: 'PENDING' }, include: {} }),
    prisma.attendance.count({ where: { isEdited: true, deletedAt: null, date: { gte: toDbDate(week) } } }),
    prisma.attendance.count({ where: { autoClosed: true, deletedAt: null, date: { gte: toDbDate(week) } } }),
    prisma.leaveAllocation.aggregate({ where: { leaveType: { name: 'Annual leave' }, periodStart: leave.yearRange(year), user: { active: true } }, _sum: { days: true } }),
    prisma.leaveRequest.aggregate({ where: { leaveType: { name: 'Annual leave' }, state: 'APPROVED', dateFrom: leave.yearRange(year), user: { active: true } }, _sum: { days: true } }),
  ]);
  const nameIds = [...new Set([...changes.map((x) => x.userId), ...requests.map((x) => x.userId)])];
  const names = new Map((await prisma.user.findMany({ where: { id: { in: nameIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

  const depts = new Map();
  people.forEach((p) => depts.set(p.department?.name || 'Unassigned', (depts.get(p.department?.name || 'Unassigned') || 0) + 1));
  const inFuture = (d) => d >= day;
  const celebrations = [];
  const horizon = addDays(day, 7);
  people.forEach((p) => {
    if (p.showBirthday && p.profile?.birthDate) {
      const on = `${yearOf(day)}-${fromDbDate(p.profile.birthDate).slice(5)}`;
      if (inFuture(on) && on <= horizon) celebrations.push({ id: `b${p.id}`, title: `${p.name} · birthday`, on });
    }
    const start = fromDbDate(p.startDate);
    const on = `${yearOf(day)}-${start.slice(5)}`;
    if (inFuture(on) && on <= horizon && start.slice(0, 4) !== String(yearOf(day))) celebrations.push({ id: `a${p.id}`, title: `${p.name} · ${yearOf(day) - yearOf(start)}-year anniversary`, on });
  });
  celebrations.sort((a, b) => a.on.localeCompare(b.on));

  const leaveToday = await prisma.leaveRequest.findMany({ where: { state: 'APPROVED', dateFrom: { lte: toDbDate(day) }, dateTo: { gte: toDbDate(day) } }, include: { leaveType: { select: { name: true } } } });
  const leaveByType = {};
  leaveToday.forEach((l) => { leaveByType[l.leaveType.name] = (leaveByType[l.leaveType.name] || 0) + 1; });
  const noEmergency = people.filter((p) => !p.profile?.emergencyName || !p.profile?.emergencyPhone).length;
  const noBirthday = people.filter((p) => !p.profile?.birthDate).length;
  const stillInvited = people.filter((p) => p.inviteStatus !== 'ACTIVATED' && p.inviteStatus !== 'NONE').length;
  const running = await prisma.contract.findMany({ where: { state: 'RUNNING', user: { active: true } }, select: { userId: true, probationEnd: true, workPermitExpiry: true, endDate: true } });
  const within = (d, n) => d && fromDbDate(d) >= day && fromDbDate(d) <= addDays(day, n);
  const withContract = new Set(running.map((r) => r.userId));
  const sickNotes = await prisma.leaveRequest.count({ where: { state: { in: leave.LIVE_STATES }, attachmentId: null, leaveType: { attachmentAfterDays: { not: null } }, days: { gt: 2 } } });
  const absentNoLeave = c.absent;

  res.json({
    active: people.length, seats, counts: c, scheduled: board.filter((b) => !['off'].includes(b.status)).length,
    joinedThisMonth: people.filter((p) => fromDbDate(p.startDate) >= monthAgo && fromDbDate(p.startDate) <= day).length,
    invitesPending: stillInvited, changeRequests: requests.length,
    leaveToday: { total: leaveToday.length, byType: leaveByType },
    leaveLiability: Math.max(0, round2((allocs._sum.days || 0) - (takenRows._sum.days || 0))),
    profileChanges: changes.map((x) => ({ ...x, userName: names.get(x.userId) })),
    pendingRequests: requests.map(({ payloadEnc, ...x }) => ({ ...x, userName: names.get(x.userId) })),
    invites: invites.map((u) => ({
      id: u.id, name: u.name, email: u.email, invitedAt: u.invitedAt, activatedAt: u.activatedAt,
      status: u.mustChangePassword && u.tempPasswordExpiry && u.tempPasswordExpiry < new Date() ? 'EXPIRED' : u.inviteStatus,
    })),
    approvalsPending: leaveInbox.length + weeks.length + missed.length + requests.length,
    departments: [...depts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    exceptions: { autoClosed: autoCount, absentToday: absentNoLeave, edited: editedCount, missedDays: missed.length },
    celebrations: celebrations.slice(0, 5),
    compliance: {
      noEmergency, noBirthday, sickNotes, noContract: people.filter((p) => !withContract.has(p.id)).length,
      probation: running.filter((r) => within(r.probationEnd, 30)).length, permits: running.filter((r) => within(r.workPermitExpiry, 60)).length, contractsEnding: running.filter((r) => within(r.endDate, 30)).length,
    },
  });
}));

module.exports = router;
