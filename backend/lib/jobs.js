const prisma = require('./prisma');
const { getSettings } = require('./settings');
const { processEmailQueue, queueEmail, notificationHtml } = require('./email');
const { closeOverdueRecords, shiftOn, scheduleOf, holidaysBetween, approvedLeaveDays } = require('./attendance');
const { accrueMonth, carryOver, expireCarryOver } = require('./leave');
const { syncAll } = require('./calendar');
const { notify } = require('./notify');
const { flushMetrics, evaluateAlerts } = require('./monitor');
const { runBackup } = require('./backup');
const { today, toDbDate, mondayOf, eachDay, fromDbDate, localDate, localTime, addDays } = require('./time');
const { isUserOnline } = require('./realtime');
const { runAs, asPlatform, currentCompanyId } = require('./tenant');
const { can } = require('./permissions');
const { adminIds } = require('./access');
const { botMessage } = require('./chat');

// A job run is recorded for the Background jobs panel on System Health.
async function tracked(name, fn) {
  const scopeId = currentCompanyId();
  const run = await prisma.jobRun.create({ data: { name, scopeId } });
  try {
    const detail = await fn();
    await prisma.jobRun.update({ where: { id: run.id }, data: { endedAt: new Date(), ok: true, detail: detail ? String(detail).slice(0, 500) : null } });
  } catch (err) {
    console.error(`job ${name} failed`, err);
    await prisma.jobRun.update({ where: { id: run.id }, data: { endedAt: new Date(), ok: false, detail: err.message.slice(0, 500) } });
  }
}

async function ranToday(name, day, tz) {
  const last = await prisma.jobRun.findFirst({ where: { name, ok: true, scopeId: currentCompanyId() }, orderBy: { startedAt: 'desc' } });
  return Boolean(last) && localDate(last.startedAt, tz) === day;
}

const autoCheckout = () => tracked('auto_checkout', async () => {
  const closed = await closeOverdueRecords();
  for (const r of closed) {
    const body = `Your check-in from ${localTime(r.checkIn, r.user.timezone)} was closed at ${localTime(r.checkOut, r.user.timezone)}. Please correct it if that's wrong.`;
    await notify(r.userId, { type: 'attendance.auto_checkout', title: 'You were automatically checked out', body, link: '/attendance' });
    await notify(r.user.managerId, { type: 'attendance.auto_checkout', title: `${r.user.name} was auto checked-out`, body: 'The record is flagged for review.', link: '/team' });
    await botMessage(r.userId, body, '/attendance');
  }
  return `closed ${closed.length} record(s)`;
});

// TS-10: anyone under their scheduled hours for the week by Friday 15:00.
async function timesheetReminders(tz) {
  const day = today(tz);
  const monday = mondayOf(day);
  const days = eachDay(monday, day);
  // Reminders only go to people whose role logs timesheets.
  const all = await prisma.user.findMany({ where: { active: true }, include: { schedule: true } });
  const users = [];
  for (const u of all) if (await can(u, 'module.timesheets')) users.push(u);
  const holidays = await holidaysBetween(monday, day);
  const leave = await approvedLeaveDays(users.map((u) => u.id), monday, day);
  const logged = await prisma.timesheetLine.groupBy({ by: ['userId'], where: { date: { gte: toDbDate(monday), lte: toDbDate(day) } }, _sum: { hours: true } });
  const loggedBy = new Map(logged.map((l) => [l.userId, l._sum.hours || 0]));
  let sent = 0;
  for (const u of users) {
    const schedule = scheduleOf(u);
    const expected = days.filter((d) => shiftOn(schedule, d) && !holidays.has(d) && !leave.get(u.id)?.has(d)).length * schedule.hoursPerDay;
    const have = loggedBy.get(u.id) || 0;
    if (expected > 0 && have < expected) {
      const body = `You've logged ${have.toFixed(1)}h of ${expected.toFixed(1)}h scheduled this week.`;
      await notify(u.id, { type: 'timesheet.reminder', title: 'Your timesheet is short this week', body, link: '/timesheets' });
      await botMessage(u.id, `Timesheet reminder: ${body}`, '/timesheets');
      sent += 1;
    }
  }
  return `reminded ${sent} people`;
}

async function birthdayNotifications(tz) {
  const day = today(tz);
  const md = day.slice(5);
  const profiles = await prisma.profile.findMany({ where: { birthDate: { not: null }, user: { active: true, showBirthday: true } }, include: { user: { select: { id: true, name: true, departmentId: true } } } });
  const hits = profiles.filter((p) => fromDbDate(p.birthDate).slice(5) === md);
  for (const p of hits) {
    await botMessage(p.userId, `Happy birthday, ${p.user.name.split(' ')[0]}! Wishing you a great day from everyone at ${(await getSettings()).companyName}.`, '/people');
    const colleagues = await prisma.user.findMany({ where: { active: true, departmentId: p.user.departmentId, id: { not: p.userId } }, select: { id: true } });
    await notify(colleagues.map((c) => c.id), { type: 'birthday.today', title: `It's ${p.user.name}'s birthday today`, body: 'Send them your wishes.', link: '/people' });
  }
  return `${hits.length} birthday(s)`;
}

// CHT-09
async function chatRetention() {
  const { chat } = await getSettings();
  const cutoff = new Date(Date.now() - chat.retentionMonths * 30.44 * 86400000);
  const { count } = await prisma.message.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return `removed ${count} message(s)`;
}

// A single summary email of what someone missed, for people who switched it on (replaces per-message mail).
async function sendChatDigests() {
  const users = await prisma.user.findMany({ where: { active: true, chatDigest: true }, select: { id: true, name: true, email: true, lastDigestAt: true } });
  let sent = 0;
  for (const u of users) {
    if (await isUserOnline(u.id)) continue;
    const members = await prisma.conversationMember.findMany({ where: { userId: u.id }, include: { conversation: { select: { name: true } } } });
    const lines = [];
    let total = 0;
    for (const m of members) {
      const after = [m.lastReadAt, u.lastDigestAt].filter(Boolean).sort((a, b) => b - a)[0];
      const count = await prisma.message.count({ where: { conversationId: m.conversationId, deletedAt: null, senderId: { not: u.id }, createdAt: after ? { gt: after } : undefined } });
      if (count) { total += count; lines.push(`${m.conversation.name ? `#${m.conversation.name}` : 'Direct message'}: ${count} new`); }
    }
    if (!total) continue;
    const title = `You have ${total} unread message${total === 1 ? '' : 's'}`;
    await queueEmail({ to: u.email, name: u.name, subject: title, html: await notificationHtml({ title, body: lines.join('\n'), link: '/chat' }), kind: 'chat.digest', userId: u.id });
    await prisma.user.update({ where: { id: u.id }, data: { lastDigestAt: new Date() } });
    sent += 1;
  }
  return `${sent} digest(s)`;
}

// Expires ended contracts and warns HR about endings, probation and work permits.
async function contractAlerts(tz) {
  const day = today(tz);
  await prisma.contract.updateMany({ where: { state: 'RUNNING', endDate: { lt: toDbDate(day) } }, data: { state: 'EXPIRED' } });
  const running = await prisma.contract.findMany({ where: { state: 'RUNNING' }, include: { user: { select: { name: true } } } });
  const hr = await adminIds();
  const on = (d, n) => d && fromDbDate(d) === addDays(day, n);
  let sent = 0;
  for (const c of running) {
    const alert = (what) => { sent += 1; return notify(hr, { type: 'payroll.contract_alert', title: `${c.user.name}: ${what}`, link: '/hr/contracts' }); };
    if (on(c.endDate, 30)) await alert('contract ends in 30 days');
    if (on(c.probationEnd, 30)) await alert('probation ends in 30 days');
    if (on(c.workPermitExpiry, 60)) await alert('work permit expires in 60 days');
  }
  return `${sent} alert(s)`;
}

// Runs a job once for each active company, inside that company's context.
async function forEachCompany(fn) {
  const companies = await prisma.company.findMany({ where: { active: true, isPlatform: false } });
  for (const c of companies) {
    await runAs(c.id, fn).catch((err) => console.error(`job failed for ${c.slug}`, err));
  }
}

async function companyMinute() {
  const { timezone: tz, timesheets } = await getSettings();
  await autoCheckout();
  const day = today(tz);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date()));
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();

  if (hour >= 6 && !(await ranToday('birthdays', day, tz))) await tracked('birthdays', () => birthdayNotifications(tz));
  if (hour >= 3 && !(await ranToday('chat_retention', day, tz))) await tracked('chat_retention', chatRetention);
  if (hour >= 5 && !(await ranToday('contract_alerts', day, tz))) await tracked('contract_alerts', () => contractAlerts(tz));
  if (hour >= 1 && !(await ranToday('leave_expiry', day, tz))) await tracked('leave_expiry', async () => `${await expireCarryOver(tz)} expired`);
  if (weekday === timesheets.reminderDay && hour >= timesheets.reminderHour && !(await ranToday('timesheet_reminders', day, tz))) {
    await tracked('timesheet_reminders', () => timesheetReminders(tz));
  }
  if (day.endsWith('-01') && !(await ranToday('leave_accrual', day, tz))) {
    await tracked('leave_accrual', async () => {
      const carried = day.endsWith('-01-01') ? await carryOver(Number(day.slice(0, 4)) - 1) : 0;
      return `${await accrueMonth(day)} accruals, ${carried} carry-overs`;
    });
  }
}

async function everyMinute() {
  await flushMetrics().catch((e) => console.error(e));
  await evaluateAlerts().catch((e) => console.error(e));
  const day = today();
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', hour12: false }).format(new Date()));
  if (hour >= 2 && !(await ranToday('backup', day, 'Africa/Johannesburg'))) await tracked('backup', async () => { const r = await runBackup(); return `${r.fileName}`; });
  await forEachCompany(companyMinute);
}

let timers = [];

function startJobs() {
  const every = (ms, fn) => timers.push(setInterval(() => asPlatform(fn).catch((e) => console.error(e)), ms));
  every(10000, () => processEmailQueue());
  every(60000, everyMinute);
  every(5 * 60000, () => forEachCompany(() => tracked('calendar_sync', async () => {
    const r = await syncAll();
    if (r.accounts && r.ok === 0) throw new Error(`All ${r.accounts} calendar accounts failed`);
    return `${r.ok}/${r.accounts} accounts`;
  })));
  every(3600000, () => forEachCompany(() => tracked('chat_digest', sendChatDigests)));
  every(5 * 60000, async () => {
    // Keeps the email-queue health signal honest: anything stuck for 15 minutes counts as a failed run.
    const stuck = await prisma.emailJob.count({ where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - 15 * 60000) } } });
    await tracked('email_queue', async () => {
      if (stuck) throw new Error(`${stuck} email(s) stuck in the queue`);
      return 'queue clear';
    });
  });
}

const stopJobs = () => { timers.forEach(clearInterval); timers = []; };

module.exports = { startJobs, stopJobs, tracked, autoCheckout, timesheetReminders, birthdayNotifications, sendChatDigests, contractAlerts };
