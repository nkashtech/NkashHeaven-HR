const express = require('express');
const prisma = require('../../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { h } = require('../middleware/validation');
const { can } = require('../../lib/permissions');
const chat = require('../../lib/chat');

const router = express.Router();
router.use(authenticate);

// How long an unanswered call keeps ringing.
const RING_MS = 45000;
// Edits overlap a little, so one saved between two checks is never missed. The browser ignores repeats.
const OVERLAP_MS = 3000;

async function ringing(userId, conversationIds) {
  const calls = await prisma.call.findMany({
    where: { conversationId: { in: conversationIds }, endedAt: null, startedById: { not: userId }, startedAt: { gt: new Date(Date.now() - RING_MS) } },
    include: { members: { where: { userId } } },
  });
  const open = calls.filter((c) => !c.members.some((m) => m.joinedAt || m.declinedAt));
  if (!open.length) return [];
  const [callers, convs] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: open.map((c) => c.startedById) } }, select: { id: true, name: true } }),
    prisma.conversation.findMany({ where: { id: { in: open.map((c) => c.conversationId) } }, select: { id: true, name: true } }),
  ]);
  return open.map((c) => ({
    id: c.id, conversationId: c.conversationId, video: c.video, callerName: callers.find((u) => u.id === c.startedById)?.name, conversationName: convs.find((x) => x.id === c.conversationId)?.name || null,
  }));
}

// Hosts without live connections, like Vercel: the browser asks here every few seconds for whatever it hasn't seen.
router.get('/', h(async (req, res) => {
  const now = new Date();
  const [latestNotification, conversationIds] = await Promise.all([
    req.query.at ? null : prisma.notification.findFirst({ where: { userId: req.user.id }, orderBy: { id: 'desc' }, select: { id: true } }),
    (await can(req.user, 'module.chat')) ? prisma.conversationMember.findMany({ where: { userId: req.user.id }, select: { conversationId: true } }).then((r) => r.map((m) => m.conversationId)) : [],
  ]);
  const cursor = { notification: Number(req.query.notification) || latestNotification?.id || 0, message: Number(req.query.message) || 0 };
  const first = !req.query.at;
  const since = first ? now : new Date(req.query.at);
  const out = { at: now.toISOString(), messages: [], updated: [], notifications: [], calls: [] };

  if (first && conversationIds.length) {
    cursor.message = (await prisma.message.findFirst({ where: { conversationId: { in: conversationIds } }, orderBy: { id: 'desc' }, select: { id: true } }))?.id || 0;
  } else if (conversationIds.length) {
    const [added, changed] = await Promise.all([
      prisma.message.findMany({ where: { conversationId: { in: conversationIds }, id: { gt: cursor.message } }, orderBy: { id: 'asc' }, take: 100 }),
      prisma.message.findMany({ where: { conversationId: { in: conversationIds }, id: { lte: cursor.message }, updatedAt: { gt: new Date(since.getTime() - OVERLAP_MS) } }, take: 100 }),
    ]);
    out.messages = await chat.hydrate(added);
    out.updated = await chat.hydrate(changed);
    if (added.length) cursor.message = added[added.length - 1].id;
  }
  if (conversationIds.length) out.calls = await ringing(req.user.id, conversationIds);
  if (!first) {
    out.notifications = await prisma.notification.findMany({ where: { userId: req.user.id, id: { gt: cursor.notification } }, orderBy: { id: 'asc' }, take: 20 });
    if (out.notifications.length) cursor.notification = out.notifications[out.notifications.length - 1].id;
  }
  out.cursor = cursor;
  res.json(out);
}));

module.exports = router;
