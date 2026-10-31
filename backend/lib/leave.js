const prisma = require('./prisma');
const { toDbDate, fromDbDate, eachDay, round2, today, addDays, monthEnd, yearOf } = require('./time');
const { scheduleOf, shiftOn, holidaysBetween } = require('./attendance');
const { leaveSteps, approversFor, stepLabel } = require('./workflow');

const OPEN_STATES = ['SUBMITTED', 'PARTLY_APPROVED'];
const LIVE_STATES = [...OPEN_STATES, 'APPROVED'];

// BR-06: working days from the employee's own schedule, excluding public holidays.
async function workingDays(user, from, to, halfDay = false) {
  const schedule = scheduleOf(user);
  const holidays = await holidaysBetween(from, to);
  const days = eachDay(from, to).filter((d) => shiftOn(schedule, d) && !holidays.has(d));
  return { days: halfDay ? (days.length ? 0.5 : 0) : days.length, excluded: [...holidays.entries()].map(([date, name]) => ({ date, name })) };
}

const yearRange = (year) => ({ gte: toDbDate(`${year}-01-01`), lte: toDbDate(`${year}-12-31`) });

// LV-10 / LV-11. "available" is what the balance card shows; "bookable" also holds back pending days (LV-04).
async function balances(userId, year, { asOf, tz } = {}) {
  const thisYear = yearOf(today(tz));
  const current = year > thisYear ? await balances(userId, thisYear, { tz }) : null;
  const [types, allocations, requests] = await Promise.all([
    prisma.leaveType.findMany({ where: { active: true }, orderBy: { id: 'asc' } }),
    prisma.leaveAllocation.findMany({ where: { userId, periodStart: yearRange(year) } }),
    prisma.leaveRequest.findMany({ where: { userId, state: { in: LIVE_STATES }, dateFrom: yearRange(year) } }),
  ]);
  return types.map((type) => {
    let allocated = round2(allocations.filter((a) => a.leaveTypeId === type.id).reduce((s, a) => s + a.days, 0));
    // Next year's allocations don't exist yet, so January bookings use what the rules will grant by then.
    const projected = Boolean(current) && !allocated && type.requiresAllocation;
    if (projected) {
      const left = current.find((c) => c.leaveTypeId === type.id)?.bookable || 0;
      const months = Number(String(asOf || `${year}-01-01`).slice(5, 7));
      allocated = round2(Math.min(Math.max(left, 0), type.maxCarryOver || 0) + (type.accrualPerMonth || 0) * months + (type.defaultDays || 0));
    }
    const mine = requests.filter((r) => r.leaveTypeId === type.id);
    const taken = round2(mine.filter((r) => r.state === 'APPROVED').reduce((s, r) => s + r.days, 0));
    const pending = round2(mine.filter((r) => OPEN_STATES.includes(r.state)).reduce((s, r) => s + r.days, 0));
    const available = type.requiresAllocation ? round2(allocated - taken) : null;
    const bookable = type.requiresAllocation ? round2(allocated - taken - pending) : null;
    return { leaveTypeId: type.id, name: type.name, colour: type.colour, requiresAllocation: type.requiresAllocation, halfDayAllowed: type.halfDayAllowed, attachmentAfterDays: type.attachmentAfterDays, allocated, taken, pending, available, bookable, projected };
  });
}

// LV-12: running ledger per type and year; the totals match the balance card.
async function statement(userId, leaveTypeId, year) {
  const type = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } });
  const [allocations, requests] = await Promise.all([
    prisma.leaveAllocation.findMany({ where: { userId, leaveTypeId, periodStart: yearRange(year) }, orderBy: { periodStart: 'asc' } }),
    prisma.leaveRequest.findMany({ where: { userId, leaveTypeId, state: { in: LIVE_STATES }, dateFrom: yearRange(year) }, orderBy: { dateFrom: 'asc' } }),
  ]);
  const lines = [];
  const accruals = allocations.filter((a) => a.kind === 'ACCRUAL');
  allocations.filter((a) => a.kind === 'CARRY_OVER').forEach((a) => lines.push({ label: a.note || `Carried over from ${year - 1}`, period: fromDbDate(a.periodStart), days: a.days }));
  allocations.filter((a) => a.kind === 'GRANT').forEach((a) => lines.push({ label: a.note || 'Allocation', period: fromDbDate(a.periodStart), days: a.days }));
  if (accruals.length) {
    const total = round2(accruals.reduce((s, a) => s + a.days, 0));
    lines.push({ label: `Monthly accrual (${accruals[0].days} × ${accruals.length} months)`, period: `${fromDbDate(accruals[0].periodStart).slice(0, 7)} to ${fromDbDate(accruals[accruals.length - 1].periodStart).slice(0, 7)}`, days: total });
  }
  allocations.filter((a) => a.kind === 'EXPIRY').forEach((a) => lines.push({ label: a.note || 'Carried-over days expired', period: fromDbDate(a.periodStart), days: a.days }));
  const approved = requests.filter((r) => r.state === 'APPROVED');
  approved.forEach((r) => lines.push({ label: `${r.halfDay ? 'Half day taken' : `${type.name} taken`}`, period: `${fromDbDate(r.dateFrom)} to ${fromDbDate(r.dateTo)}`, status: 'Approved', days: -r.days }));
  const availableToday = round2(lines.reduce((s, l) => s + l.days, 0));
  const steps = await leaveSteps(type);
  const pending = [];
  for (const r of requests.filter((x) => x.state !== 'APPROVED')) {
    pending.push({ label: 'Pending', period: `${fromDbDate(r.dateFrom)} to ${fromDbDate(r.dateTo)}`, status: `With ${await stepLabel(steps[r.stepIndex]) || 'approver'}`, days: -r.days });
  }
  return { type: { id: type.id, name: type.name, maxCarryOver: type.maxCarryOver, carryExpiry: type.carryExpiry }, year, lines, availableToday, pending };
}

// LV-13: unused carried-over days and the date they lapse.
async function expiringDays(userId, year, tz) {
  const carry = await prisma.leaveAllocation.findMany({
    where: { userId, kind: 'CARRY_OVER', periodStart: yearRange(year) }, include: { leaveType: true },
  });
  const out = [];
  for (const a of carry) {
    const expiry = fromDbDate(a.periodEnd);
    const now = today(tz);
    if (expiry < now || expiry > addDays(now, 60)) continue;
    const taken = await prisma.leaveRequest.aggregate({
      where: { userId, leaveTypeId: a.leaveTypeId, state: 'APPROVED', dateFrom: yearRange(year) }, _sum: { days: true },
    });
    const left = round2(a.days - (taken._sum.days || 0));
    if (left > 0) out.push({ leaveType: a.leaveType.name, days: left, expires: expiry });
  }
  return out;
}

// Where a new request goes, given the type's workflow and BR-07.
async function routeSubmission(employee, type) {
  const steps = await leaveSteps(type);
  if (!steps.length) return { state: 'APPROVED', approverIds: [], stepIndex: 0 };
  return { state: 'SUBMITTED', approverIds: await approversFor(steps[0], employee), stepIndex: 0 };
}

// Everyone who can act on the request right now.
async function approverIdsFor(request, employee, type) {
  const steps = await leaveSteps(type);
  const step = steps[request.stepIndex] || steps[steps.length - 1];
  return step ? approversFor(step, employee) : [];
}

// Other people away over those dates, within the same team (LV-06).
async function conflicts(request, employee) {
  const peers = await prisma.user.findMany({
    where: {
      active: true, id: { not: employee.id },
      OR: [
        employee.managerId ? { managerId: employee.managerId } : null,
        employee.departmentId ? { departmentId: employee.departmentId } : null,
      ].filter(Boolean),
    },
    select: { id: true },
  });
  if (!peers.length) return [];
  const rows = await prisma.leaveRequest.findMany({
    where: { userId: { in: peers.map((p) => p.id) }, state: { in: LIVE_STATES }, dateFrom: { lte: request.dateTo }, dateTo: { gte: request.dateFrom } },
    include: { user: { select: { name: true } } },
  });
  return rows.map((r) => ({ name: r.user.name, from: fromDbDate(r.dateFrom), to: fromDbDate(r.dateTo), pending: r.state !== 'APPROVED' }));
}

async function accrueMonth(dateStr) {
  const types = await prisma.leaveType.findMany({ where: { active: true, accrualPerMonth: { gt: 0 } } });
  const users = await prisma.user.findMany({ where: { active: true, startDate: { lte: toDbDate(dateStr) } }, select: { id: true } });
  const periodStart = toDbDate(dateStr);
  let created = 0;
  for (const type of types) {
    const done = await prisma.leaveAllocation.findMany({ where: { leaveTypeId: type.id, kind: 'ACCRUAL', periodStart }, select: { userId: true } });
    const already = new Set(done.map((d) => d.userId));
    const rows = users.filter((u) => !already.has(u.id)).map((u) => ({
      userId: u.id, leaveTypeId: type.id, days: type.accrualPerMonth, kind: 'ACCRUAL', periodStart, periodEnd: toDbDate(monthEnd(dateStr)), note: 'Monthly accrual',
    }));
    if (rows.length) created += (await prisma.leaveAllocation.createMany({ data: rows })).count;
  }
  return created;
}

// LV-13: on 1 January move unused days into the new year, capped by the type's maximum.
async function carryOver(fromYear) {
  const types = await prisma.leaveType.findMany({ where: { active: true, maxCarryOver: { gt: 0 } } });
  const users = await prisma.user.findMany({ where: { active: true }, select: { id: true } });
  const newYear = fromYear + 1;
  const periodStart = toDbDate(`${newYear}-01-01`);
  let created = 0;
  for (const user of users) {
    const bal = await balances(user.id, fromYear);
    for (const type of types) {
      const line = bal.find((b) => b.leaveTypeId === type.id);
      const exists = await prisma.leaveAllocation.findFirst({ where: { userId: user.id, leaveTypeId: type.id, kind: 'CARRY_OVER', periodStart } });
      const days = Math.min(line?.available || 0, type.maxCarryOver);
      if (exists || days <= 0) continue;
      await prisma.leaveAllocation.create({
        data: {
          userId: user.id, leaveTypeId: type.id, days, kind: 'CARRY_OVER', periodStart, note: `Carried over from ${fromYear}`,
          periodEnd: toDbDate(type.carryExpiry ? `${newYear}-${type.carryExpiry}` : `${newYear}-12-31`),
        },
      });
      created += 1;
    }
  }
  return created;
}

// Writes off carried-over days that were not used by their expiry date.
async function expireCarryOver(tz) {
  const now = today(tz);
  const year = Number(now.slice(0, 4));
  const carry = await prisma.leaveAllocation.findMany({ where: { kind: 'CARRY_OVER', periodStart: yearRange(year), periodEnd: { lt: toDbDate(now) } } });
  let expired = 0;
  for (const a of carry) {
    const already = await prisma.leaveAllocation.findFirst({ where: { userId: a.userId, leaveTypeId: a.leaveTypeId, kind: 'EXPIRY', periodStart: yearRange(year) } });
    if (already) continue;
    const taken = await prisma.leaveRequest.aggregate({
      where: { userId: a.userId, leaveTypeId: a.leaveTypeId, state: 'APPROVED', dateFrom: { gte: toDbDate(`${year}-01-01`), lte: a.periodEnd } }, _sum: { days: true },
    });
    const left = round2(a.days - (taken._sum.days || 0));
    if (left <= 0) continue;
    await prisma.leaveAllocation.create({
      data: { userId: a.userId, leaveTypeId: a.leaveTypeId, days: -left, kind: 'EXPIRY', periodStart: toDbDate(now), periodEnd: toDbDate(now), note: 'Carried-over days expired' },
    });
    expired += 1;
  }
  return expired;
}

module.exports = {
  OPEN_STATES, LIVE_STATES, workingDays, balances, statement, expiringDays, routeSubmission, approverIdsFor, conflicts, accrueMonth, carryOver, expireCarryOver, yearRange,
};
