const prisma = require('./prisma');
const { emitToUsers, isUserOnline } = require('./realtime');
const { boardFor } = require('./attendance');
const { notify } = require('./notify');

const senderSelect = { id: true, name: true, active: true };

function messageView(m, senderMap, fileMap = new Map()) {
  const sender = m.senderId ? senderMap.get(m.senderId) : null;
  return {
    id: m.id, conversationId: m.conversationId, clientId: m.clientId, senderId: m.senderId,
    senderName: m.senderId ? sender?.name || 'Unknown' : 'HR Assistant',
    formerEmployee: Boolean(sender && !sender.active),
    body: m.deletedAt ? null : m.body,
    deleted: Boolean(m.deletedAt),
    link: m.link,
    attachment: m.deletedAt || !m.attachmentId ? null : fileMap.get(m.attachmentId) || null,
    pinned: Boolean(m.pinnedAt),
    edited: Boolean(m.editedAt),
    createdAt: m.createdAt,
  };
}

async function hydrate(messages) {
  const senderIds = [...new Set(messages.map((m) => m.senderId).filter(Boolean))];
  const fileIds = [...new Set(messages.map((m) => m.attachmentId).filter(Boolean))];
  const [senders, files] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: senderIds } }, select: senderSelect }),
    prisma.fileObject.findMany({ where: { id: { in: fileIds } }, select: { id: true, name: true, mime: true, size: true } }),
  ]);
  const senderMap = new Map(senders.map((s) => [s.id, s]));
  const fileMap = new Map(files.map((f) => [f.id, f]));
  return messages.map((m) => messageView(m, senderMap, fileMap));
}

async function memberIds(conversationId) {
  return (await prisma.conversationMember.findMany({ where: { conversationId }, select: { userId: true } })).map((m) => m.userId);
}

async function postMessage({ conversationId, senderId, body, attachmentId, link, clientId }) {
  const message = await prisma.message.create({ data: { conversationId, senderId: senderId ?? null, body, attachmentId, link, clientId } });
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: message.createdAt } });
  const ids = await memberIds(conversationId);
  const [view] = await hydrate([message]);
  emitToUsers(ids, 'chat:message', view);
  // UC-11 step 5: anyone offline gets an in-app notification.
  if (senderId) {
    const offline = [];
    for (const id of ids) if (id !== senderId && !(await isUserOnline(id))) offline.push(id);
    if (offline.length) {
      const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
      await notify(offline, {
        type: 'chat.message', title: `New message from ${view.senderName}`,
        body: conv.name ? `#${conv.name}` : (body || 'Sent a file').slice(0, 120), link: `/chat?c=${conversationId}`,
      });
    }
  }
  return view;
}

async function ensureMembership(conversationId, userIds) {
  await prisma.conversationMember.createMany({ data: userIds.map((userId) => ({ conversationId, userId })), skipDuplicates: true });
}

async function botConversation(userId) {
  const key = `bot:${userId}`;
  return prisma.conversation.upsert({
    where: { directKey: key }, update: {},
    create: { type: 'BOT', directKey: key, name: 'HR Assistant', members: { create: { userId } } },
  });
}

// CHT-07. Never throws: a bot message must not fail the action behind it.
async function botMessage(userId, body, link) {
  try {
    const conv = await botConversation(userId);
    await postMessage({ conversationId: conv.id, body, link });
  } catch (err) {
    console.error('bot message failed', err);
  }
}

async function directConversation(aId, bId) {
  const [x, y] = [aId, bId].sort((p, q) => p - q);
  const key = `${x}:${y}`;
  const existing = await prisma.conversation.findUnique({ where: { directKey: key } });
  if (existing) return existing;
  return prisma.conversation.create({
    data: { type: 'DIRECT', directKey: key, createdById: aId, members: { create: [{ userId: x }, { userId: y }] } },
  });
}

async function ensureCompanyChannels() {
  for (const [channelKind, name] of [['GENERAL', 'general'], ['ANNOUNCEMENTS', 'announcements']]) {
    const found = await prisma.conversation.findFirst({ where: { type: 'CHANNEL', channelKind } });
    if (!found) await prisma.conversation.create({ data: { type: 'CHANNEL', channelKind, name } });
  }
}

const channelName = (department) => department.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

async function ensureDepartmentChannel(department) {
  const existing = await prisma.conversation.findUnique({ where: { departmentId: department.id } });
  if (existing) return existing;
  return prisma.conversation.create({
    data: { type: 'CHANNEL', channelKind: 'DEPARTMENT', departmentId: department.id, name: channelName(department)},
  });
}

// A renamed department keeps its channel and history under the new name.
async function renameDepartmentChannel(department) {
  await prisma.conversation.updateMany({ where: { departmentId: department.id }, data: { name: channelName(department) } });
}

// CHT-02, CHT-10: channel membership always follows the org structure.
async function syncUserChannels(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  await ensureCompanyChannels();
  const channels = await prisma.conversation.findMany({ where: { type: 'CHANNEL' } });
  for (const channel of channels) {
    const belongs = user.active && (channel.channelKind !== 'DEPARTMENT' || channel.departmentId === user.departmentId);
    if (belongs) await ensureMembership(channel.id, [userId]);
    else await prisma.conversationMember.deleteMany({ where: { conversationId: channel.id, userId } });
  }
  if (!user.active) {
    await prisma.conversationMember.deleteMany({ where: { userId, conversation: { type: 'GROUP' } } });
  }
}

// CHT-04: presence comes from attendance and approved leave, with Do Not Disturb on top.
async function presenceFor(users) {
  const board = await boardFor(users);
  const dnd = new Map(users.map((u) => [u.id, u.doNotDisturb]));
  return new Map(board.map((b) => {
    let status = 'offline';
    let label = 'Not checked in';
    if (b.status === 'in' || b.status === 'late') { status = 'in'; label = 'Checked in'; }
    if (b.status === 'leave') { status = 'leave'; label = `On leave until ${b.until}`; }
    return [b.id, { status, label, dnd: Boolean(dnd.get(b.id)) }];
  }));
}

module.exports = {
  hydrate, memberIds, postMessage, ensureMembership, botConversation, botMessage, directConversation,
  ensureCompanyChannels, ensureDepartmentChannel, renameDepartmentChannel, syncUserChannels, presenceFor,
};
