const express = require('express');
const prisma = require('../../lib/prisma');
const { authenticate, requirePerm } = require('../middleware/auth');
const { HttpError, h, required, intParam } = require('../middleware/validation');
const { audit } = require('../../lib/audit');
const { PERMISSIONS, ALL, OWNER_LOCKED, SCOPE_TO_LEVEL, permissionsOf, isOwner, clearPermissionCache } = require('../../lib/permissions');

const router = express.Router();
router.use(authenticate);

const SCOPES = Object.keys(SCOPE_TO_LEVEL);

function roleData(b, role) {
  const permissions = b.permissions === undefined ? undefined : [...new Set(b.permissions)].filter((k) => ALL.includes(k));
  if (b.scope !== undefined && !SCOPES.includes(b.scope)) throw new HttpError(400, 'Unknown data scope');
  if (role?.isSystem && permissions) OWNER_LOCKED.forEach((k) => { if (!permissions.includes(k)) permissions.push(k); });
  if (role?.isSystem && b.scope && b.scope !== 'COMPANY') throw new HttpError(409, 'The owner role must see the whole company');
  return { name: b.name, description: b.description, scope: b.scope, permissions };
}

// Nobody can hand out access they don't hold themselves. Only the owner touches the owner role or company-wide scope.
async function assertNoEscalation(req, permissions = [], role = null, scope = undefined) {
  if (await isOwner(req.user)) return;
  if (role?.isSystem) throw new HttpError(403, "Only the company admin can change the company admin's role");
  if (scope === 'COMPANY' || (role?.scope === 'COMPANY' && scope && scope !== 'COMPANY')) throw new HttpError(403, 'Only the company admin can change who sees the whole company');
  const mine = await permissionsOf(req.user);
  const extra = permissions.filter((k) => !mine.includes(k));
  if (extra.length) throw new HttpError(403, 'You cannot grant access you do not have');
}

// Names stay unique: adding people and CSV imports pick a role by its name.
async function assertNameFree(name, id = null) {
  if (!name) return;
  const taken = await prisma.accessRole.findFirst({ where: { name: String(name).trim(), id: id ? { not: id } : undefined } });
  if (taken) throw new HttpError(409, `A role called ${taken.name} already exists. Rename that role first, or pick another name.`);
}

// The Access screen for one person needs the permission list too.
router.get('/', requirePerm('roles.manage', 'users.assign'), h(async (req, res) => {
  const roles = await prisma.accessRole.findMany({ orderBy: [{ isSystem: 'desc' }, { name: 'asc' }], include: { _count: { select: { users: { where: { active: true } } } } } });
  res.json({ roles: roles.map(({ _count, ...r }) => ({ ...r, people: _count.users })), permissions: PERMISSIONS });
}));

router.post('/', requirePerm('roles.manage'), h(async (req, res) => {
  required(req.body, ['name']);
  const data = roleData({ scope: 'SELF', permissions: [], ...req.body });
  await assertNoEscalation(req, data.permissions, null, data.scope);
  await assertNameFree(data.name);
  const role = await prisma.accessRole.create({ data });
  clearPermissionCache();
  await audit(req, { entity: 'AccessRole', entityId: role.id, action: 'role.created', after: role });
  res.status(201).json({ role });
}));

router.patch('/:id', requirePerm('roles.manage'), h(async (req, res) => {
  const id = intParam(req.params.id);
  const before = await prisma.accessRole.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, 'Role not found');
  const data = roleData(req.body, before);
  await assertNoEscalation(req, (data.permissions || []).filter((k) => !before.permissions.includes(k)), before, data.scope);
  await assertNameFree(data.name, id);
  const role = await prisma.accessRole.update({ where: { id }, data });
  if (data.scope && data.scope !== before.scope) await prisma.user.updateMany({ where: { accessRoleId: id }, data: { role: SCOPE_TO_LEVEL[data.scope] } });
  clearPermissionCache();
  await audit(req, { entity: 'AccessRole', entityId: id, action: 'role.updated', before, after: role });
  res.json({ role });
}));

router.delete('/:id', requirePerm('roles.manage'), h(async (req, res) => {
  const id = intParam(req.params.id);
  const role = await prisma.accessRole.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
  if (!role) throw new HttpError(404, 'Role not found');
  if (role.isSystem) throw new HttpError(409, 'The owner role cannot be deleted');
  if (role.scope === 'COMPANY' && !(await isOwner(req.user))) throw new HttpError(403, 'Only the company admin can delete a company-wide role');
  if (role._count.users) throw new HttpError(409, 'Move the people in this role to another one first');
  await prisma.accessRole.delete({ where: { id } });
  clearPermissionCache();
  await audit(req, { entity: 'AccessRole', entityId: id, action: 'role.deleted', before: role });
  res.json({ ok: true });
}));

module.exports = router;
