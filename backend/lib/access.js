const prisma = require('./prisma');
const { asPlatform } = require('./tenant');

const isAdmin = (user) => user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';

// Ids of the people this user leads. Null means everyone (HR and Super Admin).
async function teamIds(user) {
  if (isAdmin(user)) return null;
  const rows = await prisma.user.findMany({
    where: { OR: [{ managerId: user.id }, { department: { managerId: user.id } }], active: true, id: { not: user.id } }, select: { id: true },
  });
  return rows.map((r) => r.id);
}

// The Prisma filter for "people this user may see", self included.
async function visibleUserFilter(user) {
  const ids = await teamIds(user);
  return ids === null ? {} : { id: { in: [user.id, ...ids] } };
}

async function canAccessUser(user, targetId) {
  if (user.id === targetId || isAdmin(user)) return true;
  return (await teamIds(user)).includes(targetId);
}

async function firstAdmin() {
  return prisma.user.findFirst({ where: { role: 'ADMIN', active: true }, orderBy: { id: 'asc' }, select: { id: true } });
}

// BR-07: their manager, else their department's manager, else Admin.
async function managerOf(employee) {
  if (employee.managerId) return employee.managerId;
  const dept = employee.departmentId ? await prisma.department.findUnique({ where: { id: employee.departmentId } }) : null;
  if (dept?.managerId && dept.managerId !== employee.id) return dept.managerId;
  return (await firstAdmin())?.id ?? null;
}

const adminIds = async () => (await prisma.user.findMany({ where: { role: 'ADMIN', active: true }, select: { id: true } })).map((u) => u.id);
const superAdminIds = async () => asPlatform(async () => (await prisma.user.findMany({ where: { role: 'SUPER_ADMIN', active: true }, select: { id: true } })).map((u) => u.id));

module.exports = { isAdmin, teamIds, visibleUserFilter, canAccessUser, managerOf, adminIds, superAdminIds };
