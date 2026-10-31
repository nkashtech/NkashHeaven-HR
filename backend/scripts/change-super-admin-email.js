// Changes the Super Admin's sign-in email. The password and two-factor stay as they are.
// Usage: DATABASE_URL="mysql://..." SUPER_ADMIN_EMAIL="you@example.com" npm run db:admin-email
require('dotenv').config();
const prisma = require('../lib/prisma');
const { asPlatform } = require('../lib/tenant');

asPlatform(async () => {
  const email = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email.includes('@')) throw new Error('Set SUPER_ADMIN_EMAIL to the new address');
  const company = await prisma.company.findFirst({ where: { isPlatform: true } });
  const user = company && await prisma.user.findFirst({ where: { companyId: company.id, role: 'SUPER_ADMIN' } });
  if (!user) throw new Error('No Super Admin found. Run npm run db:seed:prod first.');
  await prisma.user.update({ where: { id: user.id }, data: { email } });
  console.log(`Super Admin email changed from ${user.email} to ${email}`);
}).catch((err) => { console.error(err.message); process.exit(1); }).finally(() => prisma.$disconnect());
