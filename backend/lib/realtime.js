const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const prisma = require('./prisma');
const { asPlatform, runAs, currentCompanyId } = require('./tenant');

let io = null;

// Each socket joins a room per user; messages go to the rooms of the conversation's members.
function initRealtime(server, allowedOrigins) {
  io = new Server(server, { cors: { origin: allowedOrigins, credentials: true } });
  io.use(async (socket, next) => {
    try {
      const payload = jwt.verify(socket.handshake.auth?.token, process.env.JWT_SECRET);
      const session = await asPlatform(() => prisma.session.findUnique({ where: { id: payload.sid } }));
      if (!session || session.revokedAt) return next(new Error('Unauthorized'));
      socket.userId = session.userId;
      socket.companyId = session.companyId;
      return next();
    } catch {
      return next(new Error('Unauthorized'));
    }
  });
  io.on('connection', (socket) => {
    socket.join(`user:${socket.userId}`);
    socket.join(`company:${socket.companyId}`);
    socket.on('typing', ({ conversationId } = {}) => runAs(socket.companyId, async () => {
      const members = await prisma.conversationMember.findMany({ where: { conversationId }, select: { userId: true } });
      if (!members.some((m) => m.userId === socket.userId)) return;
      members.filter((m) => m.userId !== socket.userId).forEach((m) => {
        io.to(`user:${m.userId}`).emit('chat:typing', { conversationId, userId: socket.userId });
      });
    }));
  });
  return io;
}

function emitToUsers(userIds, event, data) {
  if (!io) return;
  userIds.forEach((id) => io.to(`user:${id}`).emit(event, data));
}

function broadcast(event, data) {
  if (io) io.to(`company:${currentCompanyId()}`).emit(event, data);
}

async function connectionCount() {
  return io ? (await io.fetchSockets()).length : 0;
}

const isRealtimeUp = () => Boolean(io);
const isUserOnline = async (userId) => (io ? (await io.in(`user:${userId}`).fetchSockets()).length > 0 : false);

module.exports = { initRealtime, emitToUsers, broadcast, connectionCount, isRealtimeUp, isUserOnline };
