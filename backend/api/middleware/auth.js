const jwt = require('jsonwebtoken');
const prisma = require('../../lib/prisma');
const { asPlatform, runAs } = require('../../lib/tenant');
const { getSettings } = require('../../lib/settings');
const { can } = require('../../lib/permissions');
const { isAdmin } = require('../../lib/access');
const { HttpError } = require('./validation');

// Routes a user may reach before finishing a mandatory step.
const GATE_ALLOWED = ['/api/auth/me', '/api/auth/logout', '/api/auth/change-password', '/api/auth/2fa'];
// Writes allowed while a Super Admin is viewing as someone.
const IMPERSONATION_ALLOWED = ['/api/system/impersonate/stop', '/api/auth/logout'];

const allowed = (url, list) => list.some((p) => url.startsWith(p));

function ipAllowed(ip, list) {
  if (!list?.length) return true;
  const clean = String(ip).replace('::ffff:', '');
  return list.some((entry) => entry.trim() === clean);
}

async function check(req, session) {
  const settings = await getSettings();
  const idleMs = settings.security.sessionIdleHours * 3600000;
  const expired = (session.expiresAt && session.expiresAt < new Date()) || (!session.remember && Date.now() - session.lastSeenAt.getTime() > idleMs);
  if (expired) {
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    throw new HttpError(401, 'Your session has expired. Please sign in again.');
  }
  const superAdmin = session.user.role === 'SUPER_ADMIN';
  if (session.impersonatorId) {
    if (req.method !== 'GET' && !allowed(req.originalUrl, IMPERSONATION_ALLOWED)) throw new HttpError(403, 'View-as is read-only');
  } else if (!ipAllowed(req.ip, settings.security.ipAllowlist) && !superAdmin) {
    throw new HttpError(403, 'Your network is not on the company allowlist');
  }
  if (settings.platform.maintenance && !superAdmin && !session.impersonatorId) throw new HttpError(503, settings.platform.maintenanceMessage);

  req.user = session.user;
  req.session = session;
  req.company = session.company;

  if (Date.now() - session.lastSeenAt.getTime() > 60000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  const mustEnroll = isAdmin(session.user) && settings.security.adminTwoFactorRequired && !session.user.twoFactorOn;
  if (!allowed(req.originalUrl, GATE_ALLOWED)) {
    if (session.user.mustChangePassword) throw new HttpError(403, 'Please set a new password first', { code: 'PASSWORD_CHANGE_REQUIRED' });
    if (mustEnroll && !session.impersonatorId) throw new HttpError(403, 'Two-factor authentication is required for your role', { code: 'TWO_FACTOR_REQUIRED' });
  }
}

// Sets the company for everything after it: from here on, every query is scoped to the session's company.
const authenticate = async (req, res, next) => {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!token) throw new HttpError(401, 'Please sign in');
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      throw new HttpError(401, 'Your session has expired. Please sign in again.');
    }
    const session = await asPlatform(async () => {
      const row = await prisma.session.findUnique({ where: { id: payload.sid }, include: { user: { include: { department: { select: { id: true, name: true } } } } } });
      if (!row) return null;
      return { ...row, company: await prisma.company.findUnique({ where: { id: row.companyId } }) };
    });
    if (!session || session.revokedAt || !session.user.active) throw new HttpError(401, 'Your session has expired. Please sign in again.');
    if (!session.company?.active) throw new HttpError(403, 'This company has been suspended. Contact your administrator.');
    runAs(session.companyId, async () => {
      try {
        await check(req, session);
        next();
      } catch (err) {
        next(err);
      }
    });
  } catch (err) {
    next(err);
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) return next(new HttpError(403, 'You do not have access to this'));
  return next();
};

const requirePerm = (...keys) => async (req, res, next) => {
  try {
    for (const key of keys) if (await can(req.user, key)) return next();
    throw new HttpError(403, 'You do not have access to this');
  } catch (err) {
    return next(err);
  }
};

module.exports = { authenticate, requireRole, requirePerm };
