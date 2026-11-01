const express = require('express');
const prisma = require('../../lib/prisma');
const { authenticate, requirePerm } = require('../middleware/auth');
const { HttpError, h, required, intParam } = require('../middleware/validation');
const { can } = require('../../lib/permissions');
const { audit } = require('../../lib/audit');
const calendar = require('../../lib/calendar');
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
  const last = await prisma.message.findFirst({ where: { conversationId: c.id, ...chat.visibleTo(userId) }, orderBy: { createdAt: 'desc' } });
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
    where: { conversationId: id, id: before ? { lt: before } : undefined, ...chat.visibleTo(req.user.id) }, orderBy: { id: 'desc' }, take: 50,
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
  let replyToId = null;
  if (req.body.replyToId) {
    const quoted = await prisma.message.findUnique({ where: { id: Number(req.body.replyToId) } });
    if (!quoted || quoted.conversationId !== id) throw new HttpError(400, 'That message is not in this conversation');
    replyToId = quoted.id;
  }
  const message = await chat.postMessage({ conversationId: id, senderId: req.user.id, body, attachmentId, replyToId, clientId: clientId ? String(clientId) : null });
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

// A copy in each chosen conversation, naming who wrote it first.
router.post('/messages/:id/forward', h(async (req, res) => {
  required(req.body, ['conversationIds']);
  const source = await prisma.message.findUnique({ where: { id: intParam(req.params.id) } });
  if (!source || source.deletedAt) throw new HttpError(404, 'Message not found');
  await membership(source.conversationId, req.user.id);
  const targets = [...new Set(req.body.conversationIds.map(Number))].slice(0, 20);
  if (!targets.length) throw new HttpError(400, 'Choose where to forward it');
  const convs = await prisma.conversation.findMany({ where: { id: { in: targets } } });
  for (const conv of convs) {
    await membership(conv.id, req.user.id);
    if (conv.type === 'BOT') throw new HttpError(403, 'HR Assistant only sends notifications');
    if (conv.channelKind === 'ANNOUNCEMENTS' && !(await can(req.user, 'chat.post_announcements'))) throw new HttpError(403, 'Only HR and managers can post in #announcements');
  }
  if (convs.length !== targets.length) throw new HttpError(404, 'Conversation not found');
  const [original] = await chat.hydrate([source]);
  for (const conv of convs) {
    await chat.postMessage({ conversationId: conv.id, senderId: req.user.id, body: source.body, attachmentId: source.attachmentId, forwardedFrom: original.senderName });
  }
  res.status(201).json({ forwarded: convs.length });
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
        ...chat.visibleTo(req.user.id), deletedAt: null, body: { contains: q }, senderId: req.query.personId ? Number(req.query.personId) : undefined,
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

// CHT-11: Meet and Teams have no way to start a shared room from here, so the person creates one there and shares its link.
const MEETING_HOSTS = ['meet.google.com', 'teams.microsoft.com', 'teams.live.com'];
router.post('/conversations/:id/meeting-link', h(async (req, res) => {
  const id = intParam(req.params.id);
  await membership(id, req.user.id);
  let url;
  try { url = new URL(String(req.body.url || '').trim()); } catch { throw new HttpError(400, 'Paste the full meeting link'); }
  if (url.protocol !== 'https:' || !MEETING_HOSTS.includes(url.hostname) || url.pathname.endsWith('/new')) throw new HttpError(400, 'Paste a Google Meet or Microsoft Teams meeting link');
  const message = await chat.postMessage({ conversationId: id, senderId: req.user.id, body: `${req.user.name} shared a meeting`, link: url.href, receiverOnly: true });
  res.status(201).json({ message });
}));

// One click: a real meeting on the person's own account, so everyone who joins lands in the same room.
router.post('/conversations/:id/online-meeting', h(async (req, res) => {
  const id = intParam(req.params.id);
  await membership(id, req.user.id);
  const provider = req.body.provider === 'MICROSOFT' ? 'MICROSOFT' : 'GOOGLE';
  const startAt = new Date();
  const url = await calendar.onlineMeetingFor(req.user, provider, { title: `Call with ${req.user.name}`, startAt, endAt: new Date(startAt.getTime() + 3600000) });
  const label = provider === 'GOOGLE' ? 'Google Meet' : 'Teams';
  await chat.postMessage({ conversationId: id, senderId: req.user.id, body: `${req.user.name} started a ${label} meeting`, link: url, receiverOnly: true });
  res.status(201).json({ url });
}));

// Calls in the app. Browsers connect to each other directly, so everyone in a call sends to everyone else: past a handful of people that stops working well.
const MAX_IN_CALL = 6;
const STALE_MS = 20000;

const callMembers = async (callId) => {
  const rows = await prisma.callMember.findMany({ where: { callId, joinedAt: { not: null }, leftAt: null } });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true } });
  return users;
};

async function endCall(call) {
  if (call.endedAt) return;
  const { count } = await prisma.call.updateMany({ where: { id: call.id, endedAt: null }, data: { endedAt: new Date() } });
  if (!count) return;
  await prisma.callSignal.deleteMany({ where: { callId: call.id } });
  const answered = await prisma.callMember.count({ where: { callId: call.id, joinedAt: { not: null }, userId: { not: call.startedById } } });
  const minutes = Math.max(1, Math.round((Date.now() - call.startedAt.getTime()) / 60000));
  // The "Join call" link has nothing to join any more.
  await prisma.message.updateMany({ where: { conversationId: call.conversationId, link: { endsWith: `&call=${call.id}` } }, data: { link: null } });
  if (answered) {
    await chat.postMessage({ conversationId: call.conversationId, senderId: call.startedById, body: `Call ended · ${minutes} min` });
  } else {
    const caller = await prisma.user.findUnique({ where: { id: call.startedById }, select: { name: true } });
    await chat.postMessage({ conversationId: call.conversationId, senderId: call.startedById, body: `Missed call from ${caller.name}`, receiverOnly: true });
  }
}

async function loadCall(req) {
  const call = await prisma.call.findUnique({ where: { id: intParam(req.params.id) } });
  if (!call) throw new HttpError(404, 'Call not found');
  await membership(call.conversationId, req.user.id);
  return call;
}

// Someone whose browser stopped checking in has left, and a call with nobody in it is over.
async function sweep(call) {
  await prisma.callMember.updateMany({ where: { callId: call.id, joinedAt: { not: null }, leftAt: null, lastSeenAt: { lt: new Date(Date.now() - STALE_MS) } }, data: { leftAt: new Date() } });
  if (!(await prisma.callMember.count({ where: { callId: call.id, joinedAt: { not: null }, leftAt: null } }))) await endCall(call);
}

const callView = (c) => ({ id: c.id, conversationId: c.conversationId, video: c.video, startedById: c.startedById, startedAt: c.startedAt, endedAt: c.endedAt });

router.post('/conversations/:id/calls', h(async (req, res) => {
  const id = intParam(req.params.id);
  await membership(id, req.user.id);
  const conv = await prisma.conversation.findUnique({ where: { id } });
  if (conv.type === 'BOT') throw new HttpError(403, 'You cannot call HR Assistant');
  const running = await prisma.call.findFirst({ where: { conversationId: id, endedAt: null } });
  if (running) {
    await sweep(running);
    const still = await prisma.call.findUnique({ where: { id: running.id } });
    if (!still.endedAt) return res.json({ call: callView(still), joined: false });
  }
  const now = new Date();
  const call = await prisma.call.create({ data: { conversationId: id, startedById: req.user.id, video: req.body.video !== false, members: { create: { userId: req.user.id, joinedAt: now, lastSeenAt: now } } } });
  await chat.postMessage({ conversationId: id, senderId: req.user.id, body: `${req.user.name} started a ${call.video ? 'video' : 'voice'} call`, link: `/chat?c=${id}&call=${call.id}`, receiverOnly: true });
  emitToUsers((await chat.memberIds(id)).filter((u) => u !== req.user.id), 'call:ring', { ...callView(call), callerName: req.user.name, conversationName: conv.name });
  return res.status(201).json({ call: callView(call), joined: true });
}));

router.post('/calls/:id/join', h(async (req, res) => {
  const call = await loadCall(req);
  if (call.endedAt) throw new HttpError(409, 'This call has ended');
  await sweep(call);
  const inCall = await callMembers(call.id);
  if (inCall.length >= MAX_IN_CALL && !inCall.some((u) => u.id === req.user.id)) throw new HttpError(409, `Calls can have up to ${MAX_IN_CALL} people`);
  const now = new Date();
  const data = { joinedAt: now, lastSeenAt: now, leftAt: null, declinedAt: null };
  await prisma.callMember.upsert({ where: { callId_userId: { callId: call.id, userId: req.user.id } }, create: { callId: call.id, userId: req.user.id, ...data }, update: data });
  res.json({ call: callView(call), peers: inCall.filter((u) => u.id !== req.user.id) });
}));

router.get('/calls/:id', h(async (req, res) => {
  const call = await loadCall(req);
  await prisma.callMember.updateMany({ where: { callId: call.id, userId: req.user.id, joinedAt: { not: null }, leftAt: null }, data: { lastSeenAt: new Date() } });
  await sweep(call);
  const signals = await prisma.callSignal.findMany({ where: { callId: call.id, toId: req.user.id, id: { gt: Number(req.query.after) || 0 } }, orderBy: { id: 'asc' } });
  const fresh = await prisma.call.findUnique({ where: { id: call.id } });
  res.json({ call: callView(fresh), members: await callMembers(call.id), signals: signals.map((s) => ({ id: s.id, fromId: s.fromId, kind: s.kind, payload: s.payload })) });
}));

router.post('/calls/:id/signal', h(async (req, res) => {
  required(req.body, ['toId', 'kind', 'payload']);
  const call = await loadCall(req);
  if (!['offer', 'answer'].includes(req.body.kind)) throw new HttpError(400, 'Unknown signal');
  await prisma.callSignal.create({ data: { callId: call.id, fromId: req.user.id, toId: Number(req.body.toId), kind: req.body.kind, payload: String(req.body.payload).slice(0, 200000) } });
  res.status(201).json({ ok: true });
}));

async function closeIfDirect(call) {
  const conv = await prisma.conversation.findUnique({ where: { id: call.conversationId } });
  if (conv.type === 'DIRECT') await endCall(call);
  else await sweep(call);
}

router.post('/calls/:id/decline', h(async (req, res) => {
  const call = await loadCall(req);
  const now = new Date();
  await prisma.callMember.upsert({ where: { callId_userId: { callId: call.id, userId: req.user.id } }, create: { callId: call.id, userId: req.user.id, declinedAt: now }, update: { declinedAt: now } });
  await closeIfDirect(call);
  res.json({ ok: true });
}));

router.post('/calls/:id/leave', h(async (req, res) => {
  const call = await loadCall(req);
  await prisma.callMember.updateMany({ where: { callId: call.id, userId: req.user.id }, data: { leftAt: new Date() } });
  await closeIfDirect(call);
  res.json({ ok: true });
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
