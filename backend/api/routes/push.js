const express = require('express');
const prisma = require('../../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { HttpError, h } = require('../middleware/validation');
const { pushEnabled } = require('../../lib/push');

const router = express.Router();
router.use(authenticate);

router.get('/key', h(async (req, res) => res.json({ key: pushEnabled() ? process.env.VAPID_PUBLIC_KEY : null })));

// One browser belongs to whoever signed in last, so a shared computer never rings for the previous person.
router.post('/subscribe', h(async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!/^https:\/\//.test(endpoint || '') || !keys?.p256dh || !keys?.auth) throw new HttpError(400, 'That subscription is not valid');
  const data = { userId: req.user.id, p256dh: String(keys.p256dh), auth: String(keys.auth) };
  await prisma.pushSubscription.deleteMany({ where: { endpoint: String(endpoint) } });
  await prisma.pushSubscription.create({ data: { endpoint: String(endpoint), ...data } });
  res.status(201).json({ ok: true });
}));

router.post('/unsubscribe', h(async (req, res) => {
  await prisma.pushSubscription.deleteMany({ where: { endpoint: String(req.body?.endpoint || ''), userId: req.user.id } });
  res.json({ ok: true });
}));

module.exports = router;
