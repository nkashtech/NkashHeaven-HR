// First run on a real server: creates the platform and the Super Admin, without any demo data.
// Usage: npm run db:seed:prod
// SUPER_ADMIN_EMAIL overrides the default address. SUPER_ADMIN_PASSWORD is optional. Without it a temporary password is generated and printed once.
// Either way it must be changed at first sign-in. Safe to run twice: it never touches an existing setup.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { asPlatform } = require('../lib/tenant');
const { tempPassword } = require('../lib/crypto');
const { passwordProblems } = require('../api/middleware/validation');

const DEFAULT_EMAIL = 'superadmin@nkashheaven.co.za';

asPlatform(async () => {
  if (await prisma.company.findFirst({ where: { isPlatform: true } })) {
    console.log('Already set up. Nothing changed.');
    return;
  }
  const email = (process.env.SUPER_ADMIN_EMAIL || DEFAULT_EMAIL).trim().toLowerCase();
  if (!email.includes('@')) throw new Error('SUPER_ADMIN_EMAIL is not an email address');
  const chosen = process.env.SUPER_ADMIN_PASSWORD;
  if (chosen && passwordProblems(chosen).length) throw new Error(`SUPER_ADMIN_PASSWORD needs: ${passwordProblems(chosen).join(', ')}`);
  const company = await prisma.company.create({ data: { name: 'NkashHeaven Platform', slug: 'platform', isPlatform: true } });
  const password = chosen || tempPassword(16);
  await prisma.user.create({
    data: {
      companyId: company.id, name: 'Super Admin', email, employeeNo: 'SA-0001', role: 'SUPER_ADMIN', passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true,
      startDate: new Date(new Date().toISOString().slice(0, 10)), setupCompleted: true, inviteStatus: 'ACTIVATED', profile: { create: { companyId: company.id } },
    },
  });
  console.log(`Super Admin: ${email}`);
  if (!chosen) console.log(`Temporary password (shown once): ${password}`);
}).catch((err) => { console.error(err.message); process.exit(1); }).finally(() => prisma.$disconnect());
