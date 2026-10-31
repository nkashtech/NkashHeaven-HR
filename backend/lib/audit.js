const prisma = require('./prisma');

// BR-09: who, what, old, new, when, IP. Callers strip secrets before passing before/after.
async function audit(req, { entity, entityId, action, before, after }, client = prisma) {
  return client.auditLog.create({
    data: {
      // The Super Admin works across companies, so its entries are filed under its own.
      companyId: req?.user?.companyId,
      actorId: req?.user?.id ?? null,
      actorName: req?.user?.name ?? 'System',
      entity,
      entityId: entityId === undefined || entityId === null ? null : String(entityId),
      action,
      before: before ?? undefined,
      after: after ?? undefined,
      ip: req?.ip ?? null,
    },
  });
}

async function securityEvent(type, data = {}) {
  return prisma.securityEvent.create({ data: { type, ...data } });
}

module.exports = { audit, securityEvent };
