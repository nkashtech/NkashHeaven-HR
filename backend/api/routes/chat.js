const express = require('express');
const prisma = require('../../lib/prisma');
const { authenticate, requirePerm } = require('../middleware/auth');
const { HttpError, h, required, intParam } = require('../middleware/validation');
const { can } = require('../../lib/permissions');
const { audit } = require('../../lib/audit');
const { emitToUsers } = require('../../lib/realtime');
const { getSettings } = require('../../lib/settings');
const chat = require('../../lib/chat');

const router = express.Router();
router.use(authenticate);
router.use(requirePerm('module.chat'));
router.use(h(async (req, res, next) => {
  const { system } = await getSettings();
  if (!system.flags.chat) throw new HttpError(403, 'Chat is switched off for this company');
  next();
}));

const MAX_GROUP = 50;
const EDIT_WINDOW_MS = 15 * 60000;

async function membership(conversationId, userId) {
  const member = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
  if (!member) throw new HttpError(403, 'You are not a member of this conversation');
  return member;
}

async function unreadCount(conversationId, member, userId) {
  return prisma.message.count({
    where: { conversationId, deletedAt: null, createdAt: member.lastReadAt ? { gt: member.lastReadAt } : undefined, OR: [{ senderId: null }, { senderId: { not: userId } }] },
  });
}

async function conversationView(c, member, userId, others) {
  const last = await prisma.message.findFirst({ where: { conversationId: c.id }, orderBy: { createdAt: 'desc' } });
  const other = c.type === 'DIRECT' ? others.get(c.members.find((m) => m.userId !== userId)?.userId) : null;
  return {
    id: c.id, type: c.type, channelKind: c.channelKind, name: other?.name || c.name || 'Conversation', memberCount: c.members.length,
    otherUserId: other?.id || null, presence: other?.presence || null, unread: await unreadCount(c.id, member, userId),
    lastMessage: last && !last.deletedAt ? (last.body || 'Sent a file').slice(0, 80) : last ? 'Message deleted' : null, lastMessageAt: c.lastMessageAt,
  };
}

router.get('/conversations', h(async (req, res) => {
  await chat.syncUserChannels(req.user.id);
  await chat.botConversation(req.user.id);
  const members = await prisma.conversationMember.findMany({
    where: { userId: req.user.id }, include: { conversation: { include: { members: { select: { userId: true } } } } },
  });
  const otherIds = members.filter((m) => m.conversation.type === 'DIRECT').flatMap((m) => m.conversation.members.map((x) => x.userId)).filter((id) => id !== req.user.id);
  const users = await prisma.user.findMany({ where: { id: { in: otherIds } }, include: { schedule: true } });
  const presence = await chat.presenceFor(users);
  const others = new Map(users.map((u) => [u.id, { id: u.id, name: u.active ? u.name : `${u.name} (former employee)`, presence: presence.get(u.id) }]));
  const list = await Promise.all(members.map((m) => conversationView(m.conversation, m, req.user.id, others)));
  const by = (a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0);
  res.json({
    channels: list.filter((c) => c.type === 'CHANNEL').sort((a, b) => a.name.localeCompare(b.name)),
    direct: list.filter((c) => c.type !== 'CHANNEL').sort(by),
    unread: list.reduce((s, c) => s + c.unread, 0),
  });
}));

router.get('/unread', h(async (req, res) => {
  const members = await prisma.conversationMember.findMany({ where: { userId: req.user.id } });
  let unread = 0;
  for (const m of members) unread += await unreadCount(m.conversationId, m, req.user.id);
  res.json({ unread });
}));

router.get('/conversations/:id', h(async (req, res) => {
  const id = intParam(req.params.id);
  await membership(id, req.user.id);
  const conv = await prisma.conversation.findUnique({ where: { id }, include: { members: { include: { user: { include: { schedule: true } } } } } });
  const users = conv.members.map((m) => m.user);
  const presence = await chat.presenceFor(users);
  const pins = await prisma.message.findMany({ where: { conversationId: id, pinnedAt: { not: null }, deletedAt: null }, orderBy: { pinnedAt: 'desc' } });
  const department = conv.departmentId ? await prisma.department.findUnique({ where: { id: conv.departmentId } }) : null;
  res.json({
    conversation: {
      id: conv.id, type: conv.type, channelKind: conv.channelKind, name: conv.name, department: department?.name || null,
      canPost: conv.channelKind === 'ANNOUNCEMENTS' ? await can(req.user, 'chat.post_announcements') : conv.type !== 'BOT',
      canExport: await can(req.user, 'chat.export'),
    },
    members: users.map((u) => ({ id: u.id, name: u.name, active: u.active, presence: presence.get(u.id) })),
    pins: await chat.hydrate(pins),
  });
}));

router.get('/conversations/:id/messages', h(async (req, res) => {
  const id = intParam(req.params.id);
  await membership(id, req.user.id);
  const before = req.query.before ? Number(req.query.before) : undefined;
  const rows = await prisma.message.findMany({
    where: { conversationId: id, id: before ? { lt: before } : undefined }, orderBy: { id: 'desc' }, take: 50,
  });
  res.json({ messages: await chat.hydrate(rows.reverse()), hasMore: rows.length === 50 });
}));

// clientId makes a resend after reconnecting safe (UC-11 4a).
router.post('/conversations/:id/messages', h(async (req, res) => {
  const id = intParam(req.params.id);
  await membership(id, req.user.id);
  const body = req.body.body ? String(req.body.body).trim().slice(0, 5000) : null;
  const attachmentId = req.body.attachmentId ? Number(req.body.attachmentId) : null;
  if (!body && !attachmentId) throw new HttpError(400, 'Write a message first');
  const conv = await prisma.conversation.findUnique({ where: { id } });
  if (conv.type === 'BOT') throw new HttpError(403, 'HR Assistant only sends notifications');
  if (conv.channelKind === 'ANNOUNCEMENTS' && !(await can(req.user, 'chat.post_announcements'))) {
    throw new HttpError(403, 'Only HR and managers can post in #announcements');
  }
  if (attachmentId) {
    const file = await prisma.fileObject.findUnique({ where: { id: attachmentId } });
    if (!file || file.ownerId !== req.user.id) throw new HttpError(400, 'That attachment was not found');
  }
  const { clientId } = req.body;
  if (clientId) {
    const existing = await prisma.message.findUnique({ where: { clientId: String(clientId) } });
    if (existing) return res.json({ message: (await chat.hydrate([existing]))[0] });
  }
  const message = await chat.postMessage({ conversationId: id, senderId: req.user.id, body, attachmentId, clientId: clientId ? String(clientId) : null });
  await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId: id, userId: req.user.id } }, data: { lastReadAt: new Date() } });
  return res.status(201).json({ message });
}));

router.post('/conversations/:id/read', h(async (req, res) => {
  const id = intParam(req.params.id);
  await membership(id, req.user.id);
  await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId: id, userId: req.user.id } }, data: { lastReadAt: new Date() } });
  res.json({ ok: true });
}));

router.post('/direct', h(async (req, res) => {
  required(req.body, ['userId']);
  const userId = intParam(req.body.userId, 'userId');
  if (userId === req.user.id) throw new HttpError(400, 'Pick someone else');
  const other = await prisma.user.findUnique({ where: { id: userId } });
  if (!other?.active) throw new HttpError(404, 'That person is not active');
  res.json({ conversationId: (await chat.directConversation(req.user.id, userId)).id });
}));

router.post('/groups', h(async (req, res) => {
  required(req.body, ['name', 'userIds']);
  const ids = [...new Set([req.user.id, ...req.body.userIds.map(Number)])];
  if (ids.length > MAX_GROUP) throw new HttpError(422, `Groups can have up to ${MAX_GROUP} people`);
  const conv = await prisma.conversation.create({
    data: { type: 'GROUP', name: String(req.body.name).slice(0, 80), createdById: req.user.id, members: { create: ids.map((userId) => ({ userId })) } },
  });
  res.status(201).json({ conversationId: conv.id });
}));

async function ownMessage(req) {
  const message = await prisma.message.findUnique({ where: { id: intParam(req.params.id) } });
  if (!message || message.deletedAt) throw new HttpError(404, 'Message not found');
  if (message.senderId !== req.user.id) throw new HttpError(403, 'You can only change your own messages');
  if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS) throw new HttpError(409, 'Messages can only be changed within 15 minutes');
  return message;
}

async function pushUpdate(message) {
  const [view] = await chat.hydrate([message]);
  emitToUsers(await chat.memberIds(message.conversationId), 'chat:updated', view);
  return view;
}

router.patch('/messages/:id', h(async (req, res) => {
  required(req.body, ['body']);
  const message = await ownMessage(req);
  res.json({ message: await pushUpdate(await prisma.message.update({ where: { id: message.id }, data: { body: String(req.body.body).slice(0, 5000), editedAt: new Date() } })) });
}));

router.delete('/messages/:id', h(async (req, res) => {
  const message = await ownMessage(req);
  res.json({ message: await pushUpdate(await prisma.message.update({ where: { id: message.id }, data: { deletedAt: new Date(), pinnedAt: null } })) });
}));

router.post('/messages/:id/pin', h(async (req, res) => {
  const message = await prisma.message.findUnique({ where: { id: intParam(req.params.id) } });
  if (!message) throw new HttpError(404, 'Message not found');
  await membership(message.conversationId, req.user.id);
  const updated = await prisma.message.update({
    where: { id: message.id }, data: message.pinnedAt ? { pinnedAt: null, pinnedById: null } : { pinnedAt: new Date(), pinnedById: req.user.id },
  });
  res.json({ message: await pushUpdate(updated) });
}));

// CHT-06
router.get('/search', h(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ messages: [], people: [] });
  const memberships = await prisma.conversationMember.findMany({ where: { userId: req.user.id }, select: { conversationId: true } });
  const allowed = memberships.map((m) => m.conversationId);
  const conversationId = req.query.conversationId ? Number(req.query.conversationId) : undefined;
  const [rows, people] = await Promise.all([
    prisma.message.findMany({
      where: {
        conversationId: conversationId && allowed.includes(conversationId) ? conversationId : { in: allowed },
        deletedAt: null, body: { contains: q }, senderId: req.query.personId ? Number(req.query.personId) : undefined,
        createdAt: { gte: req.query.from ? new Date(req.query.from) : undefined, lte: req.query.to ? new Date(`${req.query.to}T23:59:59Z`) : undefined },
      },
      orderBy: { createdAt: 'desc' }, take: 30,
    }),
    prisma.user.findMany({ where: { active: true, name: { contains: q }, id: { not: req.user.id }, role: { not: 'SUPER_ADMIN' } }, take: 8, select: { id: true, name: true, jobTitle: true } }),
  ]);
  return res.json({ messages: await chat.hydrate(rows), people });
}));

router.get('/people', h(async (req, res) => {
  const users = await prisma.user.findMany({
    where: { active: true, id: { not: req.user.id }, name: req.query.q ? { contains: String(req.query.q) } : undefined },
    include: { schedule: true }, orderBy: { name: 'asc' }, take: 100,
  });
  const presence = await chat.presenceFor(users);
  res.json({ people: users.map((u) => ({ id: u.id, name: u.name, jobTitle: u.jobTitle, presence: presence.get(u.id) })) });
}));

// CHT-11: Meet and Teams don't let a read-only account create rooms, so this posts a "start a meeting" link.
router.post('/conversations/:id/call', h(async (req, res) => {
  const id = intParam(req.params.id);
  await membership(id, req.user.id);
  const conn = await prisma.calendarConnection.findFirst({ where: { userId: req.user.id, status: 'CONNECTED' } });
  const url = conn?.provider === 'MICROSOFT' ? 'https://teams.microsoft.com/l/meeting/new' : 'https://meet.google.com/new';
  const message = await chat.postMessage({ conversationId: id, senderId: req.user.id, body: `${req.user.name} started a video call`, link: url });
  res.status(201).json({ message, url });
}));

// CHT-09: only with a logged reason, and only that conversation.
router.post('/conversations/:id/export', requirePerm('chat.export'), h(async (req, res) => {
  const id = intParam(req.params.id);
  required(req.body, ['reason']);
  const conv = await prisma.conversation.findUnique({ where: { id } });
  if (!conv) throw new HttpError(404, 'Conversation not found');
  const rows = await prisma.message.findMany({ where: { conversationId: id }, orderBy: { id: 'asc' } });
  const messages = await chat.hydrate(rows);
  await audit(req, { entity: 'Conversation', entityId: id, action: 'chat.exported', after: { reason: req.body.reason, messages: rows.length } });
  const text = messages.map((m) => `[${new Date(m.createdAt).toISOString()}] ${m.senderName}: ${m.deleted ? '(deleted)' : m.body || '(file)'}`).join('\n');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="conversation-${id}.txt"`);
  res.send(`Exported by ${req.user.name}\nReason: ${req.body.reason}\n\n${text}\n`);
}));

module.exports = router;
