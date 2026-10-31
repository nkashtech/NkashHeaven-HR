const prisma = require('./prisma');
const { getSettings } = require('./settings');
const { localTime, toDbDate, fromDbDate, zonedToUtc, addDays, weekdayKey, today, round2, hoursBetween, eachDay } = require('./time');

const FALLBACK_DAYS = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => [d, { start: '08:00', end: '17:00' }]));
const FALLBACK = { days: FALLBACK_DAYS, breakMinutes: 60, hoursPerDay: 8 };

const scheduleOf = (user) => user.schedule || FALLBACK;
const shiftOn = (schedule, dateStr) => (schedule.days || {})[weekdayKey(dateStr)] || null;

async function holidaysBetween(from, to) {
  const rows = await prisma.publicHoliday.findMany({ where: { date: { gte: toDbDate(from), lte: toDbDate(to) } } });
  return new Map(rows.map((h) => [fromDbDate(h.date), h.name]));
}

// date -> leave request, for approved leave touching the range
async function approvedLeaveDays(userIds, from, to) {
  const rows = await prisma.leaveRequest.findMany({
    where: { userId: { in: userIds }, state: 'APPROVED', dateFrom: { lte: toDbDate(to) }, dateTo: { gte: toDbDate(from) } },
    include: { leaveType: { select: { name: true, colour: true } } },
  });
  const byUser = new Map();
  for (const r of rows) {
    const map = byUser.get(r.userId) || new Map();
    eachDay(fromDbDate(r.dateFrom), fromDbDate(r.dateTo)).forEach((d) => map.set(d, r));
    byUser.set(r.userId, map);
  }
  return byUser;
}

// Recomputes extra hours, lateness and early departure for one person's day (ATT-11, ATT-12).
// Stored on the records so reports need no recalculation.
async function recomputeDay(userId, dateStr, client = prisma) {
  const user = await client.user.findUnique({ where: { id: userId }, include: { schedule: true } });
  const settings = await getSettings();
  const schedule = scheduleOf(user);
  const shift = shiftOn(schedule, dateStr);
  const records = await client.attendance.findMany({
    where: { userId, date: toDbDate(dateStr), deletedAt: null }, orderBy: { checkIn: 'asc' },
  });
  if (!records.length) return;

  const closed = records.filter((r) => r.checkOut);
  const worked = closed.reduce((sum, r) => sum + (r.workedHours || 0), 0);
  const hours = shift ? schedule.hoursPerDay : 0;
  // A gap between pairs is the break. Any part of the break not taken as a gap comes off the extra-hours sum.
  let gapMinutes = 0;
  for (let i = 1; i < closed.length; i += 1) gapMinutes += (closed[i].checkIn - closed[i - 1].checkOut) / 60000;
  const unbroken = shift ? Math.max(0, schedule.breakMinutes - gapMinutes) / 60 : 0;
  const extra = closed.length ? round2(worked - unbroken - hours) : null;

  const start = shift ? zonedToUtc(dateStr, shift.start, user.timezone) : null;
  const end = shift ? zonedToUtc(dateStr, shift.end, user.timezone) : null;
  const grace = settings.attendance.graceMinutes;
  const firstLate = start ? Math.round((records[0].checkIn - start) / 60000) : 0;
  const last = records[records.length - 1];
  const lastEarly = end && last.checkOut ? Math.round((end - last.checkOut) / 60000) : 0;

  for (const r of records) {
    await client.attendance.update({
      where: { id: r.id },
      data: {
        extraHours: r.id === last.id ? extra : null,
        lateMinutes: r.id === records[0].id && firstLate > grace ? firstLate : 0,
        earlyMinutes: r.id === last.id && lastEarly > grace ? lastEarly : 0,
      },
    });
  }
}

// The status pill shown in the attendance list.
function statusOf(r) {
  if (!r.checkOut) return { key: 'in_progress', label: 'In progress' };
  if (r.autoClosed && !r.isEdited) return { key: 'auto', label: 'Auto checked-out' };
  if (r.isEdited) return { key: 'edited', label: 'Edited' };
  if (r.lateMinutes) return { key: 'late', label: `Late ${r.lateMinutes} min` };
  if (r.earlyMinutes) return { key: 'early', label: `Left ${r.earlyMinutes} min early` };
  return { key: 'on_time', label: 'On time' };
}

// ATT-09 and BR-04. Throws a message the user can act on; returns null when valid.
async function validateTimes({ userId, dateStr, checkIn, checkOut, tz, excludeId }) {
  if (checkOut && checkOut <= checkIn) return 'Check-out must be after check-in';
  if (checkOut && checkOut - checkIn > 24 * 3600000) return 'A record cannot span more than 24 hours';
  if (checkIn > new Date()) return 'Check-in cannot be in the future';
  if (checkOut && checkOut > new Date()) return 'Check-out cannot be in the future';
  const dayOf = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  if (dayOf(checkIn) !== dateStr || (checkOut && dayOf(checkOut) !== dateStr)) return 'Times must stay on the same calendar day';
  const others = await prisma.attendance.findMany({
    where: { userId, deletedAt: null, id: excludeId ? { not: excludeId } : undefined, date: { gte: toDbDate(addDays(dateStr, -1)), lte: toDbDate(addDays(dateStr, 1)) } },
  });
  const end = checkOut || new Date();
  const clash = others.find((o) => checkIn < (o.checkOut || new Date()) && end > o.checkIn);
  return clash ? `Times overlap another record (${localTime(clash.checkIn, tz)}–${clash.checkOut ? localTime(clash.checkOut, tz) : 'now'})` : null;
}

async function closeOverdueRecords() {
  const settings = await getSettings();
  const open = await prisma.attendance.findMany({
    where: { openUserId: { not: null }, deletedAt: null }, include: { user: { include: { schedule: true } } },
  });
  const closed = [];
  for (const record of open) {
    const dateStr = fromDbDate(record.date);
    // ATT-10: end of the scheduled day plus the allowance; a day off falls back to 17:00.
    const shift = shiftOn(scheduleOf(record.user), dateStr) || { end: '17:00' };
    const closeAt = new Date(zonedToUtc(dateStr, shift.end, record.user.timezone).getTime() + settings.attendance.autoCheckoutHours * 3600000);
    // Someone who checked in after that moment gets the same allowance from their own check-in, capped at 24 h.
    const effective = record.checkIn >= closeAt
      ? new Date(Math.min(record.checkIn.getTime() + settings.attendance.autoCheckoutHours * 3600000, record.checkIn.getTime() + 24 * 3600000))
      : closeAt;
    if (effective > new Date()) continue;
    await prisma.attendance.update({
      where: { id: record.id },
      data: { checkOut: effective, openUserId: null, workedHours: hoursBetween(record.checkIn, effective), source: 'AUTO', autoClosed: true },
    });
    await recomputeDay(record.userId, dateStr);
    closed.push({ ...record, checkOut: effective });
  }
  return closed;
}

// Live status of a list of people today: drives the crew board, presence and dashboards.
async function boardFor(users) {
  const settings = await getSettings();
  const tz = settings.timezone;
  const day = today(tz);
  const ids = users.map((u) => u.id);
  const records = await prisma.attendance.findMany({
    where: { userId: { in: ids }, date: toDbDate(day), deletedAt: null }, orderBy: { checkIn: 'asc' },
  });
  const leave = await approvedLeaveDays(ids, day, day);
  const holidays = await holidaysBetween(day, day);
  return users.map((u) => {
    const mine = records.filter((r) => r.userId === u.id);
    const open = mine.find((r) => !r.checkOut);
    const onLeave = leave.get(u.id)?.get(day);
    const shift = shiftOn(scheduleOf(u), day);
    const lateMinutes = mine[0]?.lateMinutes || 0;
    const base = { id: u.id, name: u.name, jobTitle: u.jobTitle, shift, checkIn: mine[0]?.checkIn || null, openSince: open?.checkIn || null, lateMinutes };
    if (open) return { ...base, status: lateMinutes ? 'late' : 'in' };
    if (onLeave) return { ...base, status: 'leave', leaveType: onLeave.leaveType.name, until: fromDbDate(onLeave.dateTo) };
    if (mine.length) return { ...base, status: 'out' };
    if (holidays.has(day) || !shift || fromDbDate(u.startDate) > day) return { ...base, status: 'off' };
    const started = new Date() > new Date(zonedToUtc(day, shift.start, u.timezone).getTime() + settings.attendance.graceMinutes * 60000);
    return { ...base, status: started ? 'absent' : 'not_yet' };
  });
}

module.exports = {
  FALLBACK, scheduleOf, shiftOn, holidaysBetween, approvedLeaveDays, recomputeDay, statusOf, validateTimes, closeOverdueRecords, boardFor,
};
