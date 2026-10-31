// Sets a new password for the Super Admin and clears any lockout, for when nobody can sign in and email is not available.
// Usage: DATABASE_URL="mysql://..." npm run db:reset-admin
// SUPER_ADMIN_PASSWORD sets that password for good. Without it a temporary one is printed once and must be changed at the next sign-in.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { asPlatform } = require('../lib/tenant');
const { tempPassword } = require('../lib/crypto');
const { passwordProblems } = require('../api/middleware/validation');

asPlatform(async () => {
  const chosen = process.env.SUPER_ADMIN_PASSWORD;
  if (chosen && passwordProblems(chosen).length) throw new Error(`SUPER_ADMIN_PASSWORD needs: ${passwordProblems(chosen).join(', ')}`);
  const company = await prisma.company.findFirst({ where: { isPlatform: true } });
  const user = company && await prisma.user.findFirst({ where: { companyId: company.id, role: 'SUPER_ADMIN' } });
  if (!user) throw new Error('No Super Admin found. Run npm run db:seed:prod first.');
  const password = chosen || tempPassword(16);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(password, 10), mustChangePassword: !chosen, tempPasswordExpiry: null, failedLogins: 0, lockedUntil: null, active: true },
  });
  console.log(`Super Admin: ${user.email}`);
  if (!chosen) console.log(`Temporary password (shown once): ${password}`);
  else console.log('Password set.');
}).catch((err) => { console.error(err.message); process.exit(1); }).finally(() => prisma.$disconnect());
