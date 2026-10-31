const express = require('express');
const multer = require('multer');
const prisma = require('../../lib/prisma');
const { authenticate, requireRole } = require('../middleware/auth');
const { HttpError, h, required, intParam } = require('../middleware/validation');
const { getSettings, updateSettings, clearSettingsCache } = require('../../lib/settings');
const { asPlatform, runAs } = require('../../lib/tenant');
const { setupCompany, deleteCompany, slugify } = require('../../lib/company-setup');
const { splitName } = require('../../lib/names');
const { SCOPE_TO_LEVEL } = require('../../lib/permissions');
const { audit, securityEvent } = require('../../lib/audit');
const { listIntegrations, saveConfig, isConfigured, PROVIDERS } = require('../../lib/integrations');
const { connectionCount, isRealtimeUp } = require('../../lib/realtime');
const { saveFile, removeFile, storageBytes, isCloud } = require('../../lib/storage');
const { runBackup } = require('../../lib/backup');
const { notify } = require('../../lib/notify');
const { decrypt } = require('../../lib/crypto');
const { createSession, userView } = require('./auth');

const router = express.Router();
router.use(authenticate);

const superOnly = requireRole('SUPER_ADMIN');

// The Super Admin looks across companies on purpose; company staff stay inside their own.
router.use((req, res, next) => (req.user.role === 'SUPER_ADMIN' ? asPlatform(next) : next()));
const RANGES = { '24h': 24, '7d': 168, '30d': 720 };
const JOBS = [
  ['email_queue', 'Email queue', 'Every 10 seconds'],
  ['calendar_sync', 'Calendar sync', 'Every 5 minutes'],
  ['auto_checkout', 'Auto check-out', 'Every minute'],
  ['leave_accrual', 'Leave accrual', 'Monthly on the 1st'],
  ['timesheet_reminders', 'Timesheet reminders', 'Fridays 15:00'],
  ['birthdays', 'Birthday messages', 'Daily 06:00'],
  ['backup', 'Database backup', 'Daily 02:00'],
  ['chat_digest', 'Chat email digest', 'Hourly'],
  ['contract_alerts', 'Contract alerts', 'Daily 05:00'],
];

const bytes = (n) => Number(n || 0);

async function databaseSize() {
  const rows = await prisma.$queryRaw`SELECT COALESCE(SUM(data_length + index_length), 0) AS size FROM information_schema.tables WHERE table_schema = DATABASE()`;
  return Number(rows[0].size);
}

async function services() {
  const started = Date.now();
  let dbUp = true;
  try { await prisma.$queryRaw`SELECT 1`; } catch { dbUp = false; }
  const dbMs = Date.now() - started;
  const stats = (s, detail) => ({ status: s, detail });
  const [pendingEmail, failedEmail, sent24, google, microsoft, lastBackup, conns, googleOn, msOn, brevoOn] = await Promise.all([
    prisma.emailJob.count({ where: { status: 'PENDING' } }),
    prisma.emailJob.count({ where: { status: { in: ['FAILED', 'BOUNCED'] }, createdAt: { gte: new Date(Date.now() - 86400000) } } }),
    prisma.emailJob.count({ where: { status: 'SENT', sentAt: { gte: new Date(Date.now() - 86400000) } } }),
    prisma.calendarConnection.groupBy({ by: ['status'], where: { provider: 'GOOGLE' }, _count: { _all: true } }),
    prisma.calendarConnection.groupBy({ by: ['status'], where: { provider: 'MICROSOFT' }, _count: { _all: true } }),
    prisma.backupRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    connectionCount(),
    isConfigured('google'), isConfigured('microsoft'), isConfigured('brevo'),
  ]);
  const calendarService = (rows, on) => {
    const expired = rows.find((r) => r.status === 'RECONNECT')?._count._all || 0;
    const ok = rows.find((r) => r.status === 'CONNECTED')?._count._all || 0;
    if (!on) return stats('off', 'Not configured');
    return stats(expired ? 'degraded' : 'operational', expired ? `${expired} token(s) expired` : `${ok} connected`);
  };
  const backupAge = lastBackup?.endedAt ? (Date.now() - lastBackup.endedAt.getTime()) / 3600000 : null;
  return [
    { key: 'api', name: 'API', ...stats('operational', `${process.uptime() > 3600 ? `${Math.round(process.uptime() / 3600)}h` : `${Math.round(process.uptime() / 60)}m`} up`) },
    { key: 'db', name: 'Database (MySQL)', ...stats(dbUp ? 'operational' : 'down', `${dbMs} ms ping`) },
    { key: 'email', name: 'Email (Brevo)', ...stats(!brevoOn ? 'degraded' : failedEmail ? 'degraded' : 'operational', !brevoOn ? 'API key not set: printing to console' : `${sent24} sent, ${pendingEmail} queued, ${failedEmail} failed`) },
    { key: 'google', name: 'Google Calendar sync', ...calendarService(google, googleOn) },
    { key: 'microsoft', name: 'Microsoft 365 sync', ...calendarService(microsoft, msOn) },
    { key: 'chat', name: 'Chat (real-time)', ...stats(isRealtimeUp() ? 'operational' : 'down', `${conns} connections`) },
    { key: 'storage', name: 'File storage', ...stats('operational', `${((await storageBytes()) / 1048576).toFixed(1)} MB, ${isCloud() ? 'cloud' : 'local disk'}`) },
    {
      key: 'backup', name: 'Backups',
      ...stats(!lastBackup ? 'degraded' : lastBackup.ok === false ? 'down' : backupAge > 30 ? 'degraded' : 'operational', !lastBackup ? 'No backup yet' : lastBackup.ok === false ? 'Last backup failed' : `Last ${Math.round(backupAge)}h ago`),
    },
  ];
}

router.get('/health', superOnly, h(async (req, res) => {
  const hours = RANGES[req.query.range] || 24;
  const since = new Date(Date.now() - hours * 3600000);
  const buckets = await prisma.metricBucket.findMany({ where: { bucketAt: { gte: since } }, orderBy: { bucketAt: 'asc' } });
  const requests = buckets.reduce((s, b) => s + b.requests, 0);
  const errors = buckets.reduce((s, b) => s + b.errors, 0);
  const first = await prisma.metricBucket.findFirst({ orderBy: { bucketAt: 'asc' } });
  // Uptime = minutes with a heartbeat out of the minutes the system has existed in this window.
  const windowStart = first && first.bucketAt > since ? first.bucketAt : since;
  const expected = Math.max(1, Math.floor((Date.now() - windowStart.getTime()) / 60000));
  const uptime = Math.min(100, (buckets.length / expected) * 100);
  const slots = 12;
  const slotMs = (hours * 3600000) / slots;
  const series = Array.from({ length: slots }, (_, i) => {
    const start = since.getTime() + i * slotMs;
    const inSlot = buckets.filter((b) => b.bucketAt.getTime() >= start && b.bucketAt.getTime() < start + slotMs);
    return { at: new Date(start), p95: inSlot.length ? Math.max(...inSlot.map((b) => b.p95Ms)) : 0, requests: inSlot.reduce((s, b) => s + b.requests, 0) };
  });
  const dayStart = new Date(Date.now() - 86400000);
  const [activeSessions, emailSent, emailFailed, activeUsers, totalUsers, calendarUsers, checkInsToday, recentErrors, failedLogins, lockedAccounts, adminsNo2fa, lastBackup, alerts, dbSize, jobRuns, seatsUsed] = await Promise.all([
    prisma.session.count({ where: { revokedAt: null, lastSeenAt: { gte: new Date(Date.now() - 8 * 3600000) } } }),
    prisma.emailJob.count({ where: { status: 'SENT', sentAt: { gte: since } } }),
    prisma.emailJob.count({ where: { status: { in: ['FAILED', 'BOUNCED'] }, createdAt: { gte: since } } }),
    prisma.user.count({ where: { active: true, lastLoginAt: { gte: dayStart } } }),
    prisma.user.count({ where: { active: true } }),
    prisma.calendarConnection.count(),
    prisma.attendance.count({ where: { createdAt: { gte: dayStart } } }),
    prisma.errorLog.findMany({ orderBy: { lastAt: 'desc' }, take: 8 }),
    prisma.securityEvent.count({ where: { type: { in: ['failed_login', 'failed_2fa'] }, at: { gte: dayStart } } }),
    prisma.user.findMany({ where: { lockedUntil: { gt: new Date() } }, select: { id: true, name: true, email: true } }),
    prisma.user.count({ where: { active: true, role: { in: ['ADMIN', 'SUPER_ADMIN'] }, twoFactorOn: false } }),
    prisma.backupRun.findFirst({ where: { ok: true }, orderBy: { startedAt: 'desc' } }),
    prisma.alert.findMany({ where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, orderBy: { createdAt: 'desc' } }),
    databaseSize(),
    Promise.all(JOBS.map(([name]) => prisma.jobRun.findFirst({ where: { name, endedAt: { not: null } }, orderBy: { startedAt: 'desc' } }))),
    prisma.user.count({ where: { active: true } }),
  ]);
  const companies = await prisma.company.count({ where: { isPlatform: false } });
  const seats = (await prisma.company.aggregate({ where: { isPlatform: false }, _sum: { seats: true } }))._sum.seats || 0;
  const svc = await services();
  res.json({
    generatedAt: new Date(), overall: svc.some((s) => s.status === 'down') ? 'down' : svc.some((s) => s.status === 'degraded') || alerts.length ? 'degraded' : 'operational',
    uptime: Number(uptime.toFixed(2)), p95: buckets.length ? Math.max(...buckets.map((b) => b.p95Ms)) : 0, checkInP95: buckets.length ? Math.max(...buckets.map((b) => b.checkInP95Ms)) : 0,
    errorRate: requests ? Number(((errors / requests) * 100).toFixed(2)) : 0, requests, requestsPerHour: Math.round(requests / hours), activeSessions, checkInsToday,
    email: { sent: emailSent, failed: emailFailed, rate: emailSent + emailFailed ? Number(((emailSent / (emailSent + emailFailed)) * 100).toFixed(1)) : null },
    seats: { used: seatsUsed, total: seats }, companies, series, services: svc,
    jobs: JOBS.map(([name, label, schedule], i) => ({ name, label, schedule, ok: jobRuns[i]?.ok ?? null, lastRun: jobRuns[i]?.startedAt || null, detail: jobRuns[i]?.detail || null })),
    errors: recentErrors, alerts,
    security: { failedLogins, locked: lockedAccounts, adminsNo2fa, lastBackup: lastBackup ? { at: lastBackup.startedAt, sizeBytes: Number(lastBackup.sizeBytes) } : null },
    usage: { databaseBytes: dbSize, uploadBytes: await storageBytes(), activeUsers, totalUsers, calendarUsers },
  });
}));

router.get('/logs', superOnly, h(async (req, res) => {
  const [errors, security] = await Promise.all([
    prisma.errorLog.findMany({ orderBy: { lastAt: 'desc' }, take: 200 }),
    prisma.securityEvent.findMany({ orderBy: { at: 'desc' }, take: 200 }),
  ]);
  res.json({ errors, security });
}));

router.post('/alerts/:id/ack', superOnly, h(async (req, res) => {
  const id = intParam(req.params.id);
  await prisma.alert.update({ where: { id }, data: { status: 'ACKNOWLEDGED', ackById: req.user.id, ackAt: new Date() } });
  await audit(req, { entity: 'Alert', entityId: id, action: 'alert.acknowledged' });
  res.json({ ok: true });
}));

router.post('/users/:id/unlock', superOnly, h(async (req, res) => {
  const id = intParam(req.params.id);
  await prisma.user.update({ where: { id }, data: { lockedUntil: null, failedLogins: 0 } });
  await audit(req, { entity: 'User', entityId: id, action: 'user.unlocked' });
  res.json({ ok: true });
}));

// Companies: each is a separate tenant with its own admin, data and address.
const RESERVED = ['platform', 'card', 'api', 'admin', 'login', 'www', 'app'];

async function companyView(c) {
  const [people, active] = await Promise.all([prisma.user.count({ where: { companyId: c.id } }), prisma.user.count({ where: { companyId: c.id, active: true } })]);
  const admin = await prisma.user.findFirst({ where: { companyId: c.id, role: 'ADMIN', active: true }, orderBy: { id: 'asc' }, select: { name: true, email: true, inviteStatus: true } });
  return { id: c.id, name: c.name, slug: c.slug, hasLogo: Boolean(c.settings?.branding?.logoFileId), active: c.active, seats: c.seats, timezone: c.timezone, createdAt: c.createdAt, people, activePeople: active, admin, flags: c.settings?.system?.flags || {} };
}

router.get('/companies', superOnly, h(async (req, res) => {
  const rows = await prisma.company.findMany({ where: { isPlatform: false }, orderBy: { name: 'asc' } });
  res.json({ companies: await Promise.all(rows.map(companyView)) });
}));

// Creates the company, its starter data and its first admin, who gets the normal welcome email.
// The logo is saved inside the company, so its public link and its emails can read it.
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const takeLogo = (req, res, next) => {
  logoUpload.single('file')(req, res, (err) => asPlatform(() => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, 'Logos can be up to 5 MB'));
    if (!err && req.file && !req.file.mimetype.startsWith('image/')) return next(new HttpError(415, 'The logo must be an image'));
    return err ? next(err) : next();
  }));
};
async function saveLogo(file, ownerId) {
  const saved = await saveFile({ buffer: file.buffer, name: file.originalname, mime: file.mimetype, ownerId, purpose: 'branding' });
  await updateSettings('branding', { logoFileId: saved.id });
}

router.post('/companies', superOnly, takeLogo, h(async (req, res) => {
  required(req.body, ['name', 'adminName', 'adminEmail']);
  const slug = slugify(req.body.slug || req.body.name);
  if (slug.length < 2 || RESERVED.includes(slug)) throw new HttpError(400, 'Pick a different company address');
  if (await prisma.company.findUnique({ where: { slug } })) throw new HttpError(409, 'That company address is taken');
  const email = String(req.body.adminEmail).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid admin email');
  const timezone = req.body.timezone || 'Africa/Johannesburg';
  const company = await prisma.company.create({ data: { name: req.body.name.trim(), slug, timezone, seats: Number(req.body.seats) || 100 } });
  await setupCompany(company.id, timezone);
  const inviteSent = await runAs(company.id, async () => {
    const role = await prisma.accessRole.findFirst({ where: { isSystem: true } });
    const today = new Date().toISOString().slice(0, 10);
    const user = await prisma.user.create({
      data: {
        name: req.body.adminName.trim(), email, employeeNo: 'EMP-0001', role: SCOPE_TO_LEVEL[role.scope], accessRoleId: role.id, jobTitle: 'Company Admin', startDate: new Date(`${today}T00:00:00Z`), timezone,
        profile: { create: { legalName: req.body.adminName.trim(), ...splitName(req.body.adminName) } },
      },
    });
    const { syncUserChannels } = require('../../lib/chat');
    await syncUserChannels(user.id);
    // Before the invite, so the admin's very first email already carries the logo.
    if (req.file) await saveLogo(req.file, user.id);
    const { sendInvite } = require('./employees');
    return sendInvite(user, 'Your administrator');
  });
  await audit(req, { entity: 'Company', entityId: company.id, action: 'company.created', after: { name: company.name, slug } });
  res.status(201).json({ company: await companyView(await prisma.company.findUnique({ where: { id: company.id } })), inviteSent });
}));

router.patch('/companies/:id', superOnly, h(async (req, res) => {
  const id = intParam(req.params.id);
  const before = await prisma.company.findUnique({ where: { id } });
  if (!before || before.isPlatform) throw new HttpError(404, 'Company not found');
  const { name, seats, active, flags, slug } = req.body;
  const data = { name, seats: seats === undefined ? undefined : Number(seats), active };
  if (slug && slug !== before.slug) {
    const next = slugify(slug);
    if (RESERVED.includes(next) || (await prisma.company.findUnique({ where: { slug: next } }))) throw new HttpError(409, 'That company address is taken');
    data.slug = next;
  }
  if (flags) data.settings = { ...(before.settings || {}), system: { ...(before.settings?.system || {}), flags } };
  const company = await prisma.company.update({ where: { id }, data });
  if (active === false) await prisma.session.updateMany({ where: { companyId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  clearSettingsCache();
  await audit(req, { entity: 'Company', entityId: id, action: 'company.updated', before: { active: before.active, seats: before.seats }, after: { active: company.active, seats: company.seats } });
  res.json({ company: await companyView(company) });
}));

// A fresh temporary password for an admin who hasn't signed in yet. It replaces the one in any earlier email.
router.post('/companies/:id/resend-invite', superOnly, h(async (req, res) => {
  const id = intParam(req.params.id);
  const company = await prisma.company.findUnique({ where: { id } });
  if (!company || company.isPlatform) throw new HttpError(404, 'Company not found');
  const admin = await prisma.user.findFirst({ where: { companyId: id, role: 'ADMIN', active: true }, orderBy: { id: 'asc' } });
  if (!admin) throw new HttpError(404, 'This company has no admin');
  if (admin.inviteStatus === 'ACTIVATED') throw new HttpError(409, 'This admin has already activated their account');
  const { sendInvite } = require('./employees');
  const inviteSent = await runAs(id, () => sendInvite(admin, 'Your administrator'));
  await audit(req, { entity: 'Company', entityId: id, action: 'company.invite_resent' });
  res.json({ inviteSent });
}));

// Permanent: the company, its people and everything they hold.
router.delete('/companies/:id', superOnly, h(async (req, res) => {
  const id = intParam(req.params.id);
  const company = await prisma.company.findUnique({ where: { id } });
  if (!company || company.isPlatform) throw new HttpError(404, 'Company not found');
  const files = await deleteCompany(id);
  clearSettingsCache();
  // The data is already gone, so a file that won't delete mustn't report the whole thing as failed.
  await Promise.all(files.map((f) => removeFile(f).catch((err) => console.error(err))));
  await audit(req, { entity: 'Company', entityId: id, action: 'company.deleted', before: { name: company.name, slug: company.slug } });
  res.json({ ok: true });
}));

router.post('/companies/:id/logo', superOnly, takeLogo, h(async (req, res) => {
  const id = intParam(req.params.id);
  const company = await prisma.company.findUnique({ where: { id } });
  if (!company || company.isPlatform) throw new HttpError(404, 'Company not found');
  if (!req.file) throw new HttpError(400, 'Choose an image');
  await runAs(id, async () => saveLogo(req.file, (await prisma.user.findFirst({ orderBy: { id: 'asc' } })).id));
  await audit(req, { entity: 'Company', entityId: id, action: 'company.logo_updated' });
  res.json({ company: await companyView(await prisma.company.findUnique({ where: { id } })) });
}));

// Who the Super Admin can "view as" in a company
router.get('/companies/:id/users', superOnly, h(async (req, res) => {
  const users = await prisma.user.findMany({ where: { companyId: intParam(req.params.id), active: true }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' }, take: 300 });
  res.json({ users });
}));

// Integrations
router.get('/integrations', superOnly, h(async (req, res) => {
  res.json({ integrations: await listIntegrations(), canConfigure: req.user.role === 'SUPER_ADMIN', callbacks: { google: `${process.env.API_URL}/api/calendar/callback/google`, microsoft: `${process.env.API_URL}/api/calendar/callback/microsoft` } });
}));

router.put('/integrations/:provider', superOnly, h(async (req, res) => {
  const { provider } = req.params;
  if (!PROVIDERS[provider]) throw new HttpError(404, 'Unknown integration');
  const fields = Object.fromEntries(Object.entries(req.body).filter(([, v]) => v && !String(v).startsWith('••')));
  await saveConfig(provider, fields);
  await audit(req, { entity: 'Integration', entityId: provider, action: 'integration.updated', after: { fields: Object.keys(fields) } });
  res.json({ integrations: await listIntegrations() });
}));

// System settings
router.get('/settings', superOnly, h(async (req, res) => {
  const s = await getSettings();
  res.json({ system: s.platform });
}));

router.put('/settings', superOnly, h(async (req, res) => {
  const { system } = req.body;
  if (system) await updateSettings('system', system);
  clearSettingsCache();
  await audit(req, { entity: 'Settings', action: 'settings.system_updated', after: req.body });
  res.json({ ok: true });
}));

router.get('/backups', superOnly, h(async (req, res) => {
  const rows = await prisma.backupRun.findMany({ orderBy: { startedAt: 'desc' }, take: 30 });
  res.json({ backups: rows.map((b) => ({ ...b, sizeBytes: bytes(b.sizeBytes) })) });
}));

router.post('/backups', superOnly, h(async (req, res) => {
  try {
    const result = await runBackup(req.user.id);
    await audit(req, { entity: 'Backup', action: 'backup.run', after: result });
    res.status(201).json(result);
  } catch (err) {
    throw new HttpError(500, `Backup failed: ${err.message}`);
  }
}));

// POPIA data requests: HR requests, Super Admin runs (FRD §2).
router.get('/data-requests', requireRole('ADMIN'), h(async (req, res) => {
  const rows = await prisma.dataRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  const names = new Map((await prisma.user.findMany({ where: { id: { in: rows.flatMap((r) => [r.userId, r.requestedById]) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  res.json({ requests: rows.map((r) => ({ ...r, userName: names.get(r.userId), requestedByName: names.get(r.requestedById) })) });
}));

router.post('/data-requests', requireRole('ADMIN'), h(async (req, res) => {
  required(req.body, ['userId', 'reason']);
  const row = await prisma.dataRequest.create({ data: { userId: Number(req.body.userId), kind: 'POPIA_EXPORT', reason: req.body.reason, requestedById: req.user.id } });
  await audit(req, { entity: 'DataRequest', entityId: row.id, action: 'data_request.created', after: { userId: row.userId, reason: row.reason } });
  res.status(201).json({ id: row.id });
}));

router.post('/data-requests/:id/run', requireRole('ADMIN'), h(async (req, res) => {
  const id = intParam(req.params.id);
  const row = await prisma.dataRequest.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, 'Request not found');
  const userId = row.userId;
  const [user, profile, attendance, timesheets, leave, notifications] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, employeeNo: true, jobTitle: true, role: true, startDate: true } }),
    prisma.profile.findUnique({ where: { userId } }),
    prisma.attendance.findMany({ where: { userId } }),
    prisma.timesheetLine.findMany({ where: { userId } }),
    prisma.leaveRequest.findMany({ where: { userId } }),
    prisma.notification.findMany({ where: { userId } }),
  ]);
  const safeProfile = profile && { ...profile, idNumberEnc: undefined, taxNumberEnc: undefined, bankAccountEnc: undefined, idNumber: decrypt(profile.idNumberEnc), taxNumber: decrypt(profile.taxNumberEnc), bankAccount: decrypt(profile.bankAccountEnc) };
  await prisma.dataRequest.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } });
  await audit(req, { entity: 'DataRequest', entityId: id, action: 'data_request.exported', after: { userId } });
  res.setHeader('Content-Disposition', `attachment; filename="data-export-${userId}.json"`);
  res.json({ exportedAt: new Date(), user, profile: safeProfile, attendance, timesheets, leave, notifications });
}));

router.post('/impersonate/stop', h(async (req, res) => {
  await prisma.session.update({ where: { id: req.session.id }, data: { revokedAt: new Date() } });
  res.json({ ok: true });
}));

// "View as user": read-only, 30 minutes, audited, and the person is told (FRD §2).
router.post('/impersonate/:id', superOnly, h(async (req, res) => {
  const id = intParam(req.params.id);
  required(req.body, ['reason']);
  if (id === req.user.id) throw new HttpError(400, 'Pick someone else');
  const target = await prisma.user.findUnique({ where: { id }, include: { department: { select: { id: true, name: true } } } });
  if (!target?.active) throw new HttpError(404, 'User not found');
  const { session, token } = await createSession(req, target, false, { companyId: target.companyId, impersonatorId: req.user.id, expiresAt: new Date(Date.now() + 30 * 60000) });
  await audit(req, { entity: 'User', entityId: id, action: 'impersonation.started', after: { reason: req.body.reason } });
  await securityEvent('impersonation', { companyId: req.user.companyId, userId: req.user.id, ip: req.ip, detail: `Viewed as ${target.email}` });
  await notify(id, { type: 'system.view_as', title: 'The Super Admin viewed your account for support', body: req.body.reason, link: '/settings' });
  res.json({ token, user: await runAs(target.companyId, () => userView(target, session)) });
}));

module.exports = router;
