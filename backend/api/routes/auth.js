const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const rateLimit = require('express-rate-limit');
const prisma = require('../../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { HttpError, h, required, passwordProblems } = require('../middleware/validation');
const { encrypt, decrypt, sha256, randomToken } = require('../../lib/crypto');
const { getSettings } = require('../../lib/settings');
const { permissionsFor, leadsPeople, isOwner } = require('../../lib/permissions');
const { audit, securityEvent } = require('../../lib/audit');
const { adminIds, isAdmin } = require('../../lib/access');
const { runAs, asPlatform } = require('../../lib/tenant');
const { notify } = require('../../lib/notify');
const { queueEmail, resetHtml, companyUrl, brand, getTemplate, fill } = require('../../lib/email');

const router = express.Router();

// Sign-in is per company: the same email can exist in two companies, and an account only works at its own address.
async function companyFrom(slug) {
  const company = await prisma.company.findFirst({ where: slug ? { slug: String(slug).trim().toLowerCase() } : { isPlatform: true } });
  if (!company) throw new HttpError(404, 'We could not find that company. Check your company link.');
  if (!company.active) throw new HttpError(403, 'This company has been suspended. Contact your administrator.');
  return company;
}

const inCompany = (fn) => h(async (req, res) => {
  const company = await companyFrom(req.body?.company);
  return runAs(company.id, () => fn(req, res, company));
});

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === 'test' ? 10000 : 100, standardHeaders: true, legacyHeaders: false });

const BAD_LOGIN = 'Incorrect email or password';

function signSession(sessionId) {
  return jwt.sign({ sid: sessionId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

async function createSession(req, user, remember, extra = {}) {
  const session = await prisma.session.create({
    data: { id: crypto.randomUUID(), userId: user.id, userAgent: (req.headers['user-agent'] || '').slice(0, 255), ip: req.ip, remember: Boolean(remember), ...extra },
  });
  return { session, token: signSession(session.id) };
}

async function userView(user, session) {
  const settings = await getSettings();
  const profile = await prisma.profile.findUnique({ where: { userId: user.id } });
  const company = await prisma.company.findUnique({ where: { id: user.companyId } });
  const accessRole = user.accessRoleId ? await prisma.accessRole.findUnique({ where: { id: user.accessRoleId } }) : null;
  return {
    id: user.id, name: user.name, company: { name: company.name, slug: company.slug, isPlatform: company.isPlatform }, roleName: accessRole?.name || (user.role === 'SUPER_ADMIN' ? 'Super Admin' : null), branding: { primaryColor: settings.branding.primaryColor, hasLogo: Boolean(settings.branding.logoFileId) }, preferredName: profile?.preferredName || null, email: user.email, role: user.role, jobTitle: user.jobTitle,
    employeeNo: user.employeeNo, department: user.department || null, timezone: user.timezone, startDate: user.startDate,
    mustChangePassword: user.mustChangePassword, setupCompleted: user.setupCompleted, twoFactorOn: user.twoFactorOn,
    mustEnrollTwoFactor: isAdmin(user) && settings.security.adminTwoFactorRequired && !user.twoFactorOn,
    theme: user.theme, language: user.language, dateFormat: user.dateFormat, showBirthday: user.showBirthday, showPhone: user.showPhone, doNotDisturb: user.doNotDisturb, chatDigest: user.chatDigest,
    photoFileId: profile?.photoFileId || null,
    permissions: await permissionsFor(user),
    isOwner: user.role !== 'SUPER_ADMIN' && (await isOwner(user)),
    leadsPeople: await leadsPeople(user),
    flags: settings.system.flags,
    companyTimezone: settings.timezone,
    companyName: settings.companyName,
    impersonating: Boolean(session?.impersonatorId),
    minPasswordLength: settings.security.minPasswordLength,
  };
}

// The welcome email links here. It only identifies the invite; the temporary password still has to be typed.
router.get('/invite/:token', h(async (req, res) => {
  let payload;
  try {
    payload = jwt.verify(req.params.token, process.env.JWT_SECRET);
  } catch {
    return res.json({ valid: false });
  }
  if (payload.purpose !== 'invite') return res.json({ valid: false });
  return asPlatform(async () => {
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user?.active || !user.mustChangePassword) return res.json({ valid: false, used: true });
    if (user.inviteStatus === 'SENT') await prisma.user.update({ where: { id: user.id }, data: { inviteStatus: 'OPENED' } });
    return res.json({ valid: true, email: user.email, firstName: user.name.split(' ')[0] });
  });
}));

router.post('/login', loginLimiter, inCompany(async (req, res) => {
  required(req.body, ['email', 'password']);
  const { password, remember, code } = req.body;
  const email = String(req.body.email).trim().toLowerCase();
  const settings = await getSettings();
  const { lockoutAttempts, lockoutMinutes } = settings.security;
  const user = await prisma.user.findFirst({ where: { email }, include: { department: { select: { id: true, name: true } } } });

  if (!user || !user.active || !user.passwordHash) {
    await securityEvent('failed_login', { email, ip: req.ip, detail: user ? 'Inactive account' : 'Unknown email' });
    throw new HttpError(401, BAD_LOGIN);
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new HttpError(423, `Account locked after ${lockoutAttempts} failed attempts. Try again in a few minutes.`);
  }
  if (settings.platform.maintenance && user.role !== 'SUPER_ADMIN') throw new HttpError(503, settings.platform.maintenanceMessage);

  if (!(await bcrypt.compare(String(password), user.passwordHash))) {
    const failedLogins = user.failedLogins + 1;
    const locked = failedLogins >= lockoutAttempts;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: locked ? 0 : failedLogins, lockedUntil: locked ? new Date(Date.now() + lockoutMinutes * 60000) : undefined },
    });
    await securityEvent(locked ? 'account_locked' : 'failed_login', { userId: user.id, email, ip: req.ip });
    throw new HttpError(401, BAD_LOGIN);
  }
  if (user.mustChangePassword && user.tempPasswordExpiry && user.tempPasswordExpiry < new Date()) {
    await prisma.user.update({ where: { id: user.id }, data: { inviteStatus: 'EXPIRED' } });
    throw new HttpError(403, 'Your temporary password has expired. Ask HR to resend your invite.');
  }
  if (user.twoFactorOn) {
    if (!code) return res.json({ twoFactorRequired: true });
    if (!authenticator.check(String(code), decrypt(user.twoFactorEnc))) {
      await securityEvent('failed_2fa', { userId: user.id, email, ip: req.ip });
      throw new HttpError(401, 'That code is not correct');
    }
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  const { session, token } = await createSession(req, user, remember);
  return res.json({ token, user: await userView(user, session) });
}));

router.get('/me', authenticate, h(async (req, res) => {
  res.json({ user: await userView(req.user, req.session) });
}));

router.post('/logout', authenticate, h(async (req, res) => {
  await prisma.session.update({ where: { id: req.session.id }, data: { revokedAt: new Date() } });
  res.json({ ok: true });
}));

router.post('/change-password', authenticate, h(async (req, res) => {
  required(req.body, ['currentPassword', 'newPassword']);
  const { currentPassword, newPassword } = req.body;
  const { security } = await getSettings();
  const problems = passwordProblems(newPassword, { minLength: security.minPasswordLength });
  if (problems.length) throw new HttpError(400, 'That password does not meet the rules', { problems });
  if (!(await bcrypt.compare(String(currentPassword), req.user.passwordHash))) throw new HttpError(400, 'Your current password is not correct');
  if (await bcrypt.compare(String(newPassword), req.user.passwordHash)) throw new HttpError(400, 'Choose a password different from the current one');

  const firstTime = req.user.mustChangePassword;
  await prisma.user.update({
    where: { id: req.user.id },
    data: {
      passwordHash: await bcrypt.hash(String(newPassword), 10), mustChangePassword: false, tempPasswordExpiry: null,
      ...(firstTime ? { inviteStatus: 'ACTIVATED', activatedAt: new Date() } : {}),
    },
  });
  await prisma.session.updateMany({ where: { userId: req.user.id, id: { not: req.session.id }, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(req, { entity: 'User', entityId: req.user.id, action: firstTime ? 'invite.activated' : 'password.changed' });
  if (firstTime) {
    await notify(await adminIds(), { type: 'onboarding.activated', title: `${req.user.name} activated their account`, body: 'They signed in and chose a password.', link: '/hr/employees' });
  }
  res.json({ ok: true });
}));

router.post('/setup-complete', authenticate, h(async (req, res) => {
  await prisma.user.update({ where: { id: req.user.id }, data: { setupCompleted: true } });
  res.json({ ok: true });
}));

router.post('/forgot-password', loginLimiter, inCompany(async (req, res) => {
  required(req.body, ['email']);
  const user = await prisma.user.findFirst({ where: { email: String(req.body.email).trim().toLowerCase() } });
  if (user?.active) {
    const token = randomToken();
    await prisma.user.update({ where: { id: user.id }, data: { resetTokenHash: sha256(token), resetTokenExp: new Date(Date.now() + 3600000) } });
    const b = await brand();
    const template = await getTemplate('password_reset');
    await queueEmail({ to: user.email, name: user.name, subject: fill(template.subject, { companyName: b.companyName }), html: await resetHtml({ name: user.name, link: companyUrl(b, `/reset-password?token=${token}`) }), kind: 'password_reset', userId: user.id });
  }
  // Same answer either way, so this can't be used to discover who works here.
  res.json({ ok: true });
}));

router.post('/reset-password', loginLimiter, h(async (req, res) => {
  required(req.body, ['token', 'newPassword']);
  const user = await asPlatform(() => prisma.user.findFirst({ where: { resetTokenHash: sha256(String(req.body.token)), resetTokenExp: { gt: new Date() } } }));
  if (!user) throw new HttpError(400, 'This reset link is invalid or has expired');
  return runAs(user.companyId, () => finishReset(req, res, user));
}));

async function finishReset(req, res, user) {
  const { security } = await getSettings();
  const problems = passwordProblems(req.body.newPassword, { minLength: security.minPasswordLength });
  if (problems.length) throw new HttpError(400, 'That password does not meet the rules', { problems });
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(String(req.body.newPassword), 10), resetTokenHash: null, resetTokenExp: null, failedLogins: 0, lockedUntil: null, mustChangePassword: false, tempPasswordExpiry: null },
  });
  await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit({ user, ip: req.ip }, { entity: 'User', entityId: user.id, action: 'password.reset' });
  res.json({ ok: true });
}

router.post('/2fa/setup', authenticate, h(async (req, res) => {
  const secret = authenticator.generateSecret();
  await prisma.user.update({ where: { id: req.user.id }, data: { twoFactorEnc: encrypt(secret), twoFactorOn: false } });
  const uri = authenticator.keyuri(req.user.email, (await getSettings()).companyName, secret);
  res.json({ secret, qr: await QRCode.toDataURL(uri) });
}));

router.post('/2fa/enable', authenticate, h(async (req, res) => {
  required(req.body, ['code']);
  if (!req.user.twoFactorEnc || !authenticator.check(String(req.body.code), decrypt(req.user.twoFactorEnc))) {
    throw new HttpError(400, 'That code is not correct');
  }
  await prisma.user.update({ where: { id: req.user.id }, data: { twoFactorOn: true } });
  await audit(req, { entity: 'User', entityId: req.user.id, action: '2fa.enabled' });
  res.json({ ok: true });
}));

router.post('/2fa/disable', authenticate, h(async (req, res) => {
  required(req.body, ['password']);
  const { security } = await getSettings();
  if (isAdmin(req.user) && security.adminTwoFactorRequired) throw new HttpError(403, 'Two-factor authentication is mandatory for your role');
  if (!(await bcrypt.compare(String(req.body.password), req.user.passwordHash))) throw new HttpError(400, 'Your password is not correct');
  await prisma.user.update({ where: { id: req.user.id }, data: { twoFactorOn: false, twoFactorEnc: null } });
  await audit(req, { entity: 'User', entityId: req.user.id, action: '2fa.disabled' });
  res.json({ ok: true });
}));

router.get('/sessions', authenticate, h(async (req, res) => {
  const { security } = await getSettings();
  const cutoff = new Date(Date.now() - security.sessionIdleHours * 3600000);
  const rows = await prisma.session.findMany({
    where: { userId: req.user.id, revokedAt: null, impersonatorId: null, OR: [{ remember: true }, { lastSeenAt: { gte: cutoff } }] },
    orderBy: { lastSeenAt: 'desc' },
  });
  res.json({ sessions: rows.map((s) => ({ id: s.id, userAgent: s.userAgent, ip: s.ip, lastSeenAt: s.lastSeenAt, current: s.id === req.session.id })) });
}));

router.delete('/sessions/:id', authenticate, h(async (req, res) => {
  await prisma.session.updateMany({ where: { id: req.params.id, userId: req.user.id }, data: { revokedAt: new Date() } });
  res.json({ ok: true });
}));

router.delete('/sessions', authenticate, h(async (req, res) => {
  await prisma.session.updateMany({ where: { userId: req.user.id, id: { not: req.session.id }, revokedAt: null }, data: { revokedAt: new Date() } });
  res.json({ ok: true });
}));

module.exports = { router, userView, createSession };
