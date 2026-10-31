const express = require('express');
const prisma = require('../../lib/prisma');
const { authenticate, requirePerm } = require('../middleware/auth');
const { HttpError, h, required, intParam, dateParam } = require('../middleware/validation');
const { getSettings, effectiveLockDate } = require('../../lib/settings');
const { can } = require('../../lib/permissions');
const { audit } = require('../../lib/audit');
const { isAdmin, canAccessUser, visibleUserFilter, adminIds } = require('../../lib/access');
const { notify } = require('../../lib/notify');
const { broadcast } = require('../../lib/realtime');
const { botMessage } = require('../../lib/chat');
const {
  recomputeDay, statusOf, validateTimes, holidaysBetween, approvedLeaveDays, scheduleOf, shiftOn,
} = require('../../lib/attendance');
const {
  localDate, localTime, toDbDate, fromDbDate, zonedToUtc, today, addDays, eachDay, round2, hoursBetween, mondayOf, monthStart,
} = require('../../lib/time');

const router = express.Router();
router.use(authenticate);

// The attendance screen; HR tools and the kiosk have their own permissions.
const screen = requirePerm('module.attendance', 'attendance.create_past', 'attendance.kiosk');
router.use(screen);

const rowView = (r, tz, lockDate) => {
  const date = fromDbDate(r.date);
  return {
    id: r.id, date, userId: r.userId, userName: r.user?.name, department: r.user?.department?.name,
    checkIn: r.checkIn, checkOut: r.checkOut, checkInLocal: localTime(r.checkIn, tz), checkOutLocal: r.checkOut ? localTime(r.checkOut, tz) : null,
    workedHours: r.workedHours, extraHours: r.extraHours, lateMinutes: r.lateMinutes, isEdited: r.isEdited, autoClosed: r.autoClosed, source: r.source,
    status: statusOf(r), locked: date < lockDate,
  };
};

async function statusPayload(user) {
  const { timezone: tz } = await getSettings();
  const day = today(tz);
  const records = await prisma.attendance.findMany({ where: { userId: user.id, date: toDbDate(day), deletedAt: null }, orderBy: { checkIn: 'asc' } });
  const open = await prisma.attendance.findFirst({ where: { openUserId: user.id } });
  const closedHours = records.filter((r) => r.checkOut).reduce((s, r) => s + (r.workedHours || 0), 0);
  // The client times everything against serverNow, never its own clock (BR-01).
  return {
    serverNow: new Date(), checkedIn: Boolean(open), openSince: open?.checkIn || null, openId: open?.id || null, closedHoursToday: round2(closedHours),
    records: records.map((r) => ({ id: r.id, checkIn: localTime(r.checkIn, tz), checkOut: r.checkOut ? localTime(r.checkOut, tz) : null, workedHours: r.workedHours })),
  };
}

async function punchIn(req, user, { key = null, source = 'BUTTON' } = {}) {
  const { timezone: tz } = await getSettings();
  const now = new Date();
  const date = localDate(now, user.timezone || tz);
  try {
    await prisma.attendance.create({ data: { userId: user.id, date: toDbDate(date), checkIn: now, openUserId: user.id, idempotencyKey: key, source } });
  } catch (err) {
    if (err.code === 'P2002') throw new HttpError(409, 'You are already checked in');
    throw err;
  }
  await recomputeDay(user.id, date);
  await audit(req, { entity: 'Attendance', entityId: user.id, action: 'attendance.check_in', after: { at: now, source } });
  broadcast('presence', { userId: user.id });
  return now;
}

async function punchOut(req, user, { key = null } = {}) {
  const open = await prisma.attendance.findFirst({ where: { openUserId: user.id } });
  if (!open) throw new HttpError(409, 'You are not checked in');
  const now = new Date();
  await prisma.attendance.update({
    where: { id: open.id }, data: { checkOut: now, openUserId: null, workedHours: hoursBetween(open.checkIn, now), checkOutKey: key },
  });
  await recomputeDay(user.id, fromDbDate(open.date));
  await audit(req, { entity: 'Attendance', entityId: open.id, action: 'attendance.check_out', after: { at: now } });
  broadcast('presence', { userId: user.id });
  return now;
}

// A scanned card checks its owner in, or out if they're already in. The lookup is company-scoped, so another company's card simply isn't found.
const SCAN_COOLDOWN_MS = 60000;
router.post('/scan', requirePerm('attendance.kiosk'), h(async (req, res) => {
  required(req.body, ['token']);
  const token = String(req.body.token).trim().split('/').pop();
  const user = await prisma.user.findFirst({ where: { cardToken: token, active: true }, include: { profile: { select: { photoFileId: true } } } });
  if (!user) throw new HttpError(404, 'This card is not valid here');
  if (user.lastCardScanAt && Date.now() - user.lastCardScanAt.getTime() < SCAN_COOLDOWN_MS) {
    return res.json({ action: 'repeat', name: user.name, photoFileId: user.profile?.photoFileId || null });
  }
  const open = await prisma.attendance.findFirst({ where: { openUserId: user.id } });
  const at = open ? await punchOut(req, user) : await punchIn(req, user, { source: 'CARD' });
  await prisma.user.update({ where: { id: user.id }, data: { lastCardScanAt: new Date() } });
  return res.json({ action: open ? 'out' : 'in', name: user.name, jobTitle: user.jobTitle, photoFileId: user.profile?.photoFileId || null, at });
}));

router.get('/status', h(async (req, res) => res.json(await statusPayload(req.user))));

// ATT-01, ATT-04. The Idempotency-Key makes a network retry return the first result (UC-01 2a).
router.post('/check-in', h(async (req, res) => {
  const key = req.headers['idempotency-key'] || null;
  if (key) {
    const replay = await prisma.attendance.findFirst({ where: { idempotencyKey: key } });
    if (replay?.userId === req.user.id) return res.json(await statusPayload(req.user));
  }
  await punchIn(req, req.user, { key });
  return res.status(201).json(await statusPayload(req.user));
}));

router.post('/check-out', h(async (req, res) => {
  const key = req.headers['idempotency-key'] || null;
  if (key) {
    const replay = await prisma.attendance.findFirst({ where: { checkOutKey: key } });
    if (replay?.userId === req.user.id) return res.json(await statusPayload(req.user));
  }
  await punchOut(req, req.user, { key });
  return res.json(await statusPayload(req.user));
}));

// Rows for one person include empty scheduled days, shown as Absent with no way to add them (UC-02 1b).
function absentRows(user, from, to, existingDays, leave, holidays, tz, requested) {
  const schedule = scheduleOf(user);
  const start = fromDbDate(user.startDate);
  const rows = [];
  const lastDay = addDays(today(tz), -1);
  for (const date of eachDay(from < start ? start : from, to > lastDay ? lastDay : to)) {
    if (existingDays.has(date) || !shiftOn(schedule, date) || holidays.has(date)) continue;
    const onLeave = leave?.get(date);
    rows.push(onLeave
      ? { id: `leave-${date}`, date, userId: user.id, userName: user.name, leave: onLeave.leaveType.name, status: { key: 'leave', label: 'On leave' } }
      : { id: `absent-${date}`, date, userId: user.id, userName: user.name, status: { key: 'absent', label: 'Absent' }, missedRequest: requested.get(date) || null });
  }
  return rows;
}

// ATT-06
router.get('/', h(async (req, res) => {
  const settings = await getSettings();
  const tz = settings.timezone;
  const to = req.query.to ? dateParam(req.query.to, 'to') : today(tz);
  const from = req.query.from ? dateParam(req.query.from, 'from') : addDays(to, -29);
  const lockDate = effectiveLockDate(settings, tz);
  const scope = req.query.scope || 'mine';
  const where = { date: { gte: toDbDate(from), lte: toDbDate(to) }, deletedAt: null };

  let single = null;
  if (scope === 'mine') {
    where.userId = req.user.id;
    single = req.user.id;
  } else if (req.query.userId) {
    const id = intParam(req.query.userId, 'userId');
    if (!(await canAccessUser(req.user, id))) throw new HttpError(403, 'You do not have access to this person');
    where.userId = id;
    single = id;
  } else {
    const filter = await visibleUserFilter(req.user);
    where.user = { ...filter, departmentId: req.query.departmentId ? Number(req.query.departmentId) : undefined };
  }

  const rows = await prisma.attendance.findMany({
    where, orderBy: [{ date: 'desc' }, { checkIn: 'desc' }], take: 2000,
    include: { user: { select: { name: true, department: { select: { name: true } } } } },
  });
  let items = rows.map((r) => rowView(r, tz, lockDate));

  if (single) {
    const user = await prisma.user.findUnique({ where: { id: single }, include: { schedule: true } });
    const [holidays, leaveMap, requests] = await Promise.all([
      holidaysBetween(from, to), approvedLeaveDays([single], from, to),
      prisma.missedDayRequest.findMany({ where: { userId: single, date: { gte: toDbDate(from), lte: toDbDate(to) } } }),
    ]);
    const days = new Set(items.map((i) => i.date));
    const requested = new Map(requests.map((r) => [fromDbDate(r.date), r.status]));
    items = [...items, ...absentRows(user, from, to, days, leaveMap.get(single), holidays, tz, requested)]
      .sort((a, b) => (a.date === b.date ? String(b.checkIn).localeCompare(String(a.checkIn)) : b.date.localeCompare(a.date)));
  }

  const worked = round2(items.reduce((s, i) => s + (i.workedHours || 0), 0));
  const lateDays = new Set(items.filter((i) => i.lateMinutes).map((i) => `${i.userId}:${i.date}`)).size;
  const extra = round2(items.reduce((s, i) => s + (i.extraHours || 0), 0));
  res.json({ items, summary: { worked, lateDays, extra }, lockDate, canCreate: await can(req.user, 'attendance.create_past') });
}));

router.get('/edits', h(async (req, res) => {
  const userId = req.query.userId ? intParam(req.query.userId, 'userId') : req.user.id;
  if (!(await canAccessUser(req.user, userId))) throw new HttpError(403, 'You do not have access to this person');
  const edits = await prisma.attendanceEdit.findMany({
    where: { attendance: { userId } }, orderBy: { editedAt: 'desc' }, take: 30, include: { attendance: { select: { date: true } } },
  });
  const editors = await prisma.user.findMany({ where: { id: { in: edits.map((e) => e.editorId) } }, select: { id: true, name: true } });
  const names = new Map(editors.map((e) => [e.id, e.name]));
  res.json({ edits: edits.map((e) => ({ ...e, date: fromDbDate(e.attendance.date), editorName: e.editorId === req.user.id ? 'You' : names.get(e.editorId) })) });
}));

async function ensureCanEdit(req, record) {
  const own = record.userId === req.user.id;
  if (!own) {
    if (!(await can(req.user, 'attendance.edit_team')) || !(await canAccessUser(req.user, record.userId))) {
      throw new HttpError(403, 'You cannot edit this record');
    }
  }
  const settings = await getSettings();
  const lockDate = effectiveLockDate(settings, settings.timezone);
  if (fromDbDate(record.date) < lockDate && !isAdmin(req.user)) throw new HttpError(403, 'Period locked — contact HR');
}

// ATT-07, BR-02, BR-04: times only, on a record that exists. The date itself can't change.
router.patch('/:id', h(async (req, res) => {
  const id = intParam(req.params.id);
  required(req.body, ['reason']);
  const record = await prisma.attendance.findUnique({ where: { id }, include: { user: true } });
  if (!record || record.deletedAt) throw new HttpError(404, 'Record not found');
  if (!record.checkOut) throw new HttpError(409, 'Check out first: a running record cannot be edited');
  await ensureCanEdit(req, record);

  const tz = record.user.timezone;
  const dateStr = fromDbDate(record.date);
  const parse = (hhmm, fallback) => {
    if (!hhmm) return fallback;
    if (!/^\d{2}:\d{2}$/.test(hhmm)) throw new HttpError(400, 'Times must be HH:mm');
    return zonedToUtc(dateStr, hhmm, tz);
  };
  const checkIn = parse(req.body.checkIn, record.checkIn);
  const checkOut = parse(req.body.checkOut, record.checkOut);
  const problem = await validateTimes({ userId: record.userId, dateStr, checkIn, checkOut, tz, excludeId: id });
  if (problem) throw new HttpError(422, problem);

  const edits = [];
  if (checkIn.getTime() !== record.checkIn.getTime()) edits.push(['check-in', localTime(record.checkIn, tz), localTime(checkIn, tz)]);
  if (checkOut.getTime() !== record.checkOut.getTime()) edits.push(['check-out', localTime(record.checkOut, tz), localTime(checkOut, tz)]);
  if (!edits.length) throw new HttpError(400, 'Nothing has changed');

  await prisma.$transaction(async (tx) => {
    await tx.attendance.update({ where: { id }, data: { checkIn, checkOut, workedHours: hoursBetween(checkIn, checkOut), isEdited: true, reviewedAt: new Date() } });
    await tx.attendanceEdit.createMany({ data: edits.map(([field, oldValue, newValue]) => ({ attendanceId: id, editorId: req.user.id, field, oldValue, newValue, reason: String(req.body.reason).slice(0, 500) })) });
    await audit(req, { entity: 'Attendance', entityId: id, action: 'attendance.edited', before: { checkIn: record.checkIn, checkOut: record.checkOut }, after: { checkIn, checkOut, reason: req.body.reason } }, tx);
  });
  await recomputeDay(record.userId, dateStr);
  if (record.userId !== req.user.id) {
    await notify(record.userId, { type: 'attendance.edited', title: `${req.user.name} edited your attendance`, body: `${dateStr}: ${edits.map(([f, a, b]) => `${f} ${a} → ${b}`).join(', ')}`, link: '/attendance' });
  }
  res.json({ ok: true });
}));

// ATT-08: past days can't be created by anyone but Admin, and Admin must give a reason.
router.post('/', h(async (req, res) => {
  if (!(await can(req.user, 'attendance.create_past'))) {
    throw new HttpError(403, 'Attendance is only created by Check In. To add a missed day, contact HR.');
  }
  required(req.body, ['userId', 'date', 'checkIn', 'checkOut', 'reason']);
  const userId = intParam(req.body.userId, 'userId');
  const dateStr = dateParam(req.body.date);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(404, 'Employee not found');
  const tz = user.timezone;
  const checkIn = zonedToUtc(dateStr, req.body.checkIn, tz);
  const checkOut = zonedToUtc(dateStr, req.body.checkOut, tz);
  const problem = await validateTimes({ userId, dateStr, checkIn, checkOut, tz });
  if (problem) throw new HttpError(422, problem);
  const record = await prisma.attendance.create({
    data: { userId, date: toDbDate(dateStr), checkIn, checkOut, workedHours: hoursBetween(checkIn, checkOut), source: 'ADMIN' },
  });
  await prisma.attendanceEdit.create({ data: { attendanceId: record.id, editorId: req.user.id, field: 'created', newValue: `${req.body.checkIn}–${req.body.checkOut}`, reason: String(req.body.reason).slice(0, 500) } });
  await recomputeDay(userId, dateStr);
  await prisma.missedDayRequest.updateMany({ where: { userId, date: toDbDate(dateStr), status: 'PENDING' }, data: { status: 'APPROVED', decidedById: req.user.id, decidedAt: new Date() } });
  await audit(req, { entity: 'Attendance', entityId: record.id, action: 'attendance.admin_created', after: { userId, date: dateStr, checkIn, checkOut, reason: req.body.reason } });
  await notify(userId, { type: 'attendance.added', title: 'HR added an attendance record for you', body: `${dateStr}: ${req.body.checkIn}–${req.body.checkOut}. ${req.body.reason}`, link: '/attendance' });
  res.status(201).json({ id: record.id });
}));

router.delete('/:id', requirePerm('attendance.delete'), h(async (req, res) => {
  const id = intParam(req.params.id);
  required(req.body || {}, ['reason']);
  const record = await prisma.attendance.findUnique({ where: { id } });
  if (!record || record.deletedAt) throw new HttpError(404, 'Record not found');
  // Soft delete: FRD §7 forbids hard deletes of attendance.
  await prisma.attendance.update({ where: { id }, data: { deletedAt: new Date(), openUserId: null } });
  await recomputeDay(record.userId, fromDbDate(record.date));
  await audit(req, { entity: 'Attendance', entityId: id, action: 'attendance.deleted', before: { checkIn: record.checkIn, checkOut: record.checkOut }, after: { reason: req.body.reason } });
  res.json({ ok: true });
}));

// Clears an auto check-out from the review queue when it stands as recorded.
router.post('/:id/review', h(async (req, res) => {
  const id = intParam(req.params.id);
  const record = await prisma.attendance.findUnique({ where: { id } });
  if (!record) throw new HttpError(404, 'Record not found');
  if (record.userId === req.user.id || !(await canAccessUser(req.user, record.userId))) throw new HttpError(403, 'You cannot review this record');
  await prisma.attendance.update({ where: { id }, data: { reviewedAt: new Date() } });
  await audit(req, { entity: 'Attendance', entityId: id, action: 'attendance.reviewed' });
  res.json({ ok: true });
}));

// An employee asks HR to add a day; HR's "Add record" fulfils it.
router.post('/missed-day', h(async (req, res) => {
  required(req.body, ['date', 'note']);
  const date = dateParam(req.body.date);
  const { timezone: tz } = await getSettings();
  if (date >= today(tz)) throw new HttpError(400, 'You can only ask about a past day');
  await prisma.missedDayRequest.create({ data: { userId: req.user.id, date: toDbDate(date), note: String(req.body.note).slice(0, 500) } });
  await notify(await adminIds(), { type: 'approvals.missed_day', title: `${req.user.name} asked HR to add a missed day`, body: `${date}: ${req.body.note}`, link: '/hr/approvals' });
  res.status(201).json({ ok: true });
}));

router.post('/missed-day/:id/refuse', requirePerm('attendance.create_past'), h(async (req, res) => {
  const id = intParam(req.params.id);
  required(req.body, ['reason']);
  const row = await prisma.missedDayRequest.update({ where: { id }, data: { status: 'REJECTED', decidedById: req.user.id, decidedAt: new Date() } });
  await audit(req, { entity: 'MissedDayRequest', entityId: id, action: 'missed_day.refused', after: { reason: req.body.reason } });
  await notify(row.userId, { type: 'approvals.missed_day', title: 'HR did not add your missed day', body: req.body.reason, link: '/attendance' });
  await botMessage(row.userId, `HR did not add your missed day (${fromDbDate(row.date)}): ${req.body.reason}`, '/attendance');
  res.json({ ok: true });
}));

// ATT-11 monthly balance and the "This week" card
router.get('/summary', h(async (req, res) => {
  const { timezone: tz } = await getSettings();
  const day = today(tz);
  const monday = mondayOf(day);
  const rows = await prisma.attendance.findMany({ where: { userId: req.user.id, deletedAt: null, date: { gte: toDbDate(addDays(monthStart(day), -7)), lte: toDbDate(day) } } });
  const week = eachDay(monday, addDays(monday, 6)).map((date) => ({
    date, hours: round2(rows.filter((r) => fromDbDate(r.date) === date).reduce((s, r) => s + (r.workedHours || 0), 0)),
  }));
  const monthExtra = round2(rows.filter((r) => fromDbDate(r.date) >= monthStart(day)).reduce((s, r) => s + (r.extraHours || 0), 0));
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: { schedule: true } });
  const schedule = scheduleOf(user);
  const shift = shiftOn(schedule, day);
  const scheduled = eachDay(monday, addDays(monday, 6)).filter((d) => shiftOn(schedule, d)).length * schedule.hoursPerDay;
  res.json({ week, monthExtra, scheduled, worked: round2(week.reduce((s, d) => s + d.hours, 0)), shift });
}));

module.exports = router;
