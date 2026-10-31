const express = require('express');
const prisma = require('../../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { h, intParam } = require('../middleware/validation');
const { GROUPS, prefsFor } = require('../../lib/notify');

const router = express.Router();
router.use(authenticate);

router.get('/', h(async (req, res) => {
  const where = { userId: req.user.id };
  if (req.query.unread === 'true') where.readAt = null;
  if (req.query.group) where.type = { startsWith: `${req.query.group}.` };
  const [notifications, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: Math.min(Number(req.query.limit) || 50, 100) }),
    prisma.notification.count({ where: { userId: req.user.id, readAt: null } }),
  ]);
  res.json({ notifications, unread, groups: Object.entries(GROUPS).map(([key, g]) => ({ key, label: g.label })) });
}));

router.post('/read-all', h(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
}));

router.post('/:id/read', h(async (req, res) => {
  await prisma.notification.updateMany({ where: { id: intParam(req.params.id), userId: req.user.id }, data: { readAt: new Date() } });
  res.json({ ok: true });
}));

router.get('/preferences', h(async (req, res) => {
  res.json({ preferences: Object.entries(GROUPS).map(([key, g]) => ({ key, label: g.label, ...prefsFor(req.user, key) })) });
}));

router.put('/preferences', h(async (req, res) => {
  const incoming = req.body.preferences || {};
  const next = { ...(req.user.notifyPrefs || {}) };
  for (const key of Object.keys(GROUPS)) {
    if (incoming[key]) next[key] = { inApp: Boolean(incoming[key].inApp), email: Boolean(incoming[key].email) };
  }
  await prisma.user.update({ where: { id: req.user.id }, data: { notifyPrefs: next } });
  res.json({ ok: true });
}));

module.exports = router;
