// Sends one real welcome email through Brevo, in a company's own name and design.
// Usage: npm run test:brevo -- you@example.com [company-slug]
require('dotenv').config();
const prisma = require('../lib/prisma');
const { asPlatform, runAs } = require('../lib/tenant');
const { getConfig } = require('../lib/integrations');
const { brand, getTemplate, fill, queueEmail, processEmailQueue, welcomeHtml } = require('../lib/email');

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function main() {
  const [to, slug = 'nkashheaven'] = process.argv.slice(2);
  if (!to) throw new Error('Usage: npm run test:brevo -- you@example.com [company-slug]');
  if (process.env.NODE_ENV !== 'production' && !(process.env.EMAIL_TEST_ALLOW || '').toLowerCase().split(',').map((s) => s.trim()).includes(to.toLowerCase())) {
    throw new Error(`${to} isn't in EMAIL_TEST_ALLOW in backend/.env, so it would only print to the console`);
  }
  const company = await asPlatform(async () => { const row = await prisma.company.findUnique({ where: { slug } }); return row; });
  if (!company) throw new Error(`No company with the address "${slug}"`);

  const job = await runAs(company.id, async () => {
    if (!(await getConfig('brevo')).apiKey) throw new Error('No Brevo key: set BREVO_API_KEY in backend/.env');
    const template = await getTemplate('welcome');
    const { companyName } = await brand();
    return queueEmail({
      to, name: 'Test Person', kind: 'test', subject: `[Test] ${fill(template.subject, { companyName })}`,
      html: await welcomeHtml({
        signInUrl: `${process.env.CLIENT_URL || 'http://localhost:3010'}/c/${slug}/login`, design: template.design, name: 'Test Person', email: to,
        tempPassword: 'This is only a test', intro: template.body, hrName: 'Your administrator', expires: 'Not applicable', startDate: 'Not applicable',
      }),
    });
  });

  await asPlatform(() => processEmailQueue());
  // A running backend may pick the job up first, so wait for the result either way.
  for (let i = 0; i < 20; i += 1) {
    const result = await asPlatform(async () => { const row = await prisma.emailJob.findUnique({ where: { id: job.id } }); return row; });
    if (result.status === 'SENT') { console.log(`Brevo accepted the email to ${to} from ${company.name}. Message ID: ${result.providerId}`); return; }
    if (result.lastError) throw new Error(`Failed: ${result.lastError}`);
    await sleep(1000);
  }
  throw new Error('Timed out waiting for the email to send');
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
