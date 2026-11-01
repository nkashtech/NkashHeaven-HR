const prisma = require('./prisma');
const { encrypt, decrypt } = require('./crypto');
const { getConfig } = require('./integrations');
const { getSettings } = require('./settings');

const MAX_ATTEMPTS = 5;
const clientUrl = () => (process.env.CLIENT_URL || 'http://localhost:3010').split(',')[0];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const apiUrl = () => process.env.API_URL || 'http://localhost:3011';

async function brand() {
  const { branding, companyName, slug } = await getSettings();
  return { ...branding, companyName, slug };
}

// Links in emails go through the company's own address, so nobody lands on another company's sign-in.
const companyUrl = (b, path) => `${clientUrl()}${b.slug && b.slug !== 'platform' ? `/c/${b.slug}` : ''}${path}`;

function layout(inner, b, design = {}) {
  const fileUrl = (id) => `${esc(apiUrl())}/api/public/${esc(b.slug)}/image/${id}`;
  const name = b.slug === 'platform' ? 'NkashHeaven-HR' : b.companyName;
  const logo = b.logoFileId
    ? `<td><img src="${esc(apiUrl())}/api/public/${esc(b.slug)}/logo/main" alt="" height="40" style="display:block;max-width:200px"></td>`
    : '<td style="background:#d9633a;color:#fff;font-weight:700;font-size:20px;width:36px;height:36px;text-align:center;border-radius:9px">N</td>';
  const mark = `${logo}<td style="padding-left:10px;font-size:18px;font-weight:700">${esc(name)}</td>`;
  return `<!doctype html><html><body style="margin:0;background:${esc(design.backgroundColor || '#ecedf0')};font-family:Inter,Helvetica,Arial,sans-serif;color:${esc(design.textColor || '#1a1a1a')}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:${esc(design.cardColor || '#ffffff')};border-radius:16px;overflow:hidden" cellpadding="0" cellspacing="0">
${design.headerImageId ? `<tr><td><img src="${fileUrl(design.headerImageId)}" alt="" width="560" style="display:block;width:100%"></td></tr>` : ''}
<tr><td style="padding:32px 32px 8px"><table role="presentation"><tr>${mark}</tr></table></td></tr>
<tr><td style="padding:16px 32px 28px;font-size:15px;line-height:1.55">${inner}</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #eee;font-size:12px;color:#666">${esc(b.companyName)} · ${esc(b.emailFooter)} · ${esc(b.address)}</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href, label, b, design = {}) => `<p style="margin:22px 0 8px"><a href="${esc(href)}" style="background:${esc(design.buttonColor || b.primaryColor)};color:#fff;text-decoration:none;font-weight:600;padding:13px 26px;border-radius:10px;display:inline-block">${esc(label)}</a></p>`;

// Everything a company can reword. {{placeholders}} are filled at send time.
const TEMPLATES = {
  welcome: {
    label: 'Welcome email', placeholders: ['firstName', 'hrName', 'companyName'],
    subject: 'Welcome to {{companyName}} — your sign-in details',
    body: '{{hrName}} has created your {{companyName}} account. You will use it to check in and out, log timesheets, apply for leave, see your calendar and chat with your team.',
  },
  password_reset: {
    label: 'Password reset', placeholders: ['firstName', 'companyName'],
    subject: 'Reset your {{companyName}} password',
    body: 'Hi {{firstName}}, we received a request to reset your {{companyName}} password. This link works once and expires in 1 hour.',
  },
  notification: {
    label: 'General notifications', placeholders: ['companyName'],
    subject: '{{title}}', body: '', heading: '{{title}}',
  },
  payslip_ready: {
    label: 'Payslip ready', placeholders: ['firstName', 'period', 'companyName'],
    subject: 'Your payslip for {{period}} is ready',
    body: 'Hi {{firstName}}, your payslip for {{period}} is ready. Sign in to view or print it.',
  },
};

async function getTemplate(key) {
  const row = await prisma.emailTemplate.findFirst({ where: { key } });
  return row ? { ...TEMPLATES[key], subject: row.subject, body: row.body, design: row.design || {} } : { ...TEMPLATES[key], design: {} };
}

const fill = (text, vars) => text.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] === undefined ? m : vars[k]));

async function welcomeHtml({ name, email, tempPassword, expires, startDate, managerName, hrName, intro, signInUrl, design = {} }) {
  const b = await brand();
  const first = name.split(' ')[0];
  const signIn = signInUrl || companyUrl(b, '/login');
  const text = esc(fill(intro, { hrName, firstName: first, companyName: b.companyName }));
  const row = (k, v, mono) => `<tr><td style="color:#666;padding:4px 18px 4px 0">${k}</td><td style="font-weight:600;${mono ? 'font-family:Menlo,Consolas,monospace;' : ''}">${esc(v)}</td></tr>`;
  const step = (n, s) => `<tr><td valign="top" style="padding:4px 10px 4px 0"><span style="background:#fbe6dc;color:#8f3c19;font-weight:700;border-radius:50%;display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;font-size:12px">${n}</span></td><td style="padding:6px 0">${esc(s)}</td></tr>`;
  return layout(`<h1 style="font-size:26px;margin:0 0 12px">${esc(fill(design.heading || 'Hi {{firstName}}, welcome aboard', { firstName: first, companyName: b.companyName }))}</h1><p>${text}</p>
<div style="background:#fdf6f2;border:1px solid #f3dfd4;border-radius:12px;padding:16px 18px;margin:18px 0">
<div style="font-size:12px;font-weight:700;letter-spacing:.05em;color:#8f3c19;margin-bottom:6px">YOUR SIGN-IN DETAILS</div>
<table role="presentation" style="font-size:14px">${row('Username', email)}${row('Temporary password', tempPassword, true)}${row('Expires', `${expires} (72 hours)`)}${startDate ? row('Start date', startDate) : ''}${managerName ? row('Manager', managerName) : ''}</table></div>
${button(signIn, design.buttonText || 'Sign in and choose your password', b, design)}<p style="font-size:13px;color:#555">Or paste this link: ${esc(signIn)}</p>
<p style="font-weight:600;margin:20px 0 4px">Your first 5 minutes</p>
<table role="presentation" style="font-size:14px">${step(1, 'Click the button above and enter the temporary password.')}${step(2, 'Choose your own password (you will be asked straight away).')}${step(3, 'Check your profile, add an emergency contact, and connect your Google or Outlook calendar.')}${step(4, 'On your start date, press Check In.')}</table>
<div style="background:#f6f6f7;border-radius:10px;padding:12px 16px;margin-top:18px;font-size:13px;color:#444">For your security: the temporary password works once and expires after 72 hours. We will never ask for your password by email or phone. Didn't expect this email? Contact your HR team.</div>`, b, design);
}

async function resetHtml({ name, link }) {
  const b = await brand();
  const t = await getTemplate('password_reset');
  const d = t.design;
  return layout(`<h1 style="font-size:24px;margin:0 0 12px">${esc(d.heading || 'Reset your password')}</h1><p>${esc(fill(t.body, { firstName: name.split(' ')[0], companyName: b.companyName }))}</p>${button(link, d.buttonText || 'Choose a new password', b, d)}<p style="font-size:13px;color:#555">If you didn't ask for this, you can ignore this email.</p>`, b, d);
}

async function notificationHtml({ title, body, link }) {
  const b = await brand();
  const t = await getTemplate('notification');
  const d = t.design;
  const intro = t.body ? `<p>${esc(fill(t.body, { companyName: b.companyName }))}</p>` : '';
  return layout(`<h1 style="font-size:21px;margin:0 0 12px">${esc(title)}</h1>${intro}${body ? `<p style="white-space:pre-line">${esc(body)}</p>` : ''}${link ? button(companyUrl(b, link), d.buttonText || `Open ${b.companyName}`, b, d) : ''}`, b, d);
}

async function meetingHtml({ name, organiser, title, when, kind, location, description, joinUrl, acceptUrl, declineUrl }) {
  const b = await brand();
  const row = (k, v) => (v ? `<tr><td style="color:#666;padding:4px 18px 4px 0" valign="top">${k}</td><td style="font-weight:600;padding:4px 0">${esc(v)}</td></tr>` : '');
  const decline = `<a href="${esc(declineUrl)}" style="display:inline-block;border:1px solid #d5d5d8;border-radius:10px;color:#1a1a1a;font-weight:600;padding:12px 22px;text-decoration:none;margin-left:8px">Decline</a>`;
  const accept = `<a href="${esc(acceptUrl)}" style="display:inline-block;background:${esc(b.primaryColor || '#B34D22')};border-radius:10px;color:#fff;font-weight:600;padding:12px 22px;text-decoration:none">Accept</a>`;
  return layout(`<h1 style="font-size:22px;margin:0 0 12px">${esc(title)}</h1><p>Hi ${esc(name.split(' ')[0])}, ${esc(organiser)} invited you to a meeting.</p>
<div style="background:#f6f6f7;border-radius:12px;padding:14px 18px;margin:16px 0"><table role="presentation" style="font-size:14px">${row('When', when)}${row('Type', kind)}${row('Where', location)}${row('About', description)}</table></div>
<p style="margin:20px 0">${accept}${decline}</p>
${joinUrl ? `<p style="font-size:14px"><b>Meeting link</b><br><a href="${esc(joinUrl)}">${esc(joinUrl)}</a></p>` : ''}`, b);
}

async function payslipHtml({ name, period }) {
  const b = await brand();
  const t = await getTemplate('payslip_ready');
  const vars = { firstName: name.split(' ')[0], period, companyName: b.companyName };
  const d = t.design;
  return { subject: fill(t.subject, vars), html: layout(`<h1 style="font-size:22px;margin:0 0 12px">${esc(fill(d.heading || t.subject, vars))}</h1><p>${esc(fill(t.body, vars))}</p>${button(companyUrl(b, '/payslips'), d.buttonText || 'View my payslip', b, d)}`, b, d) };
}

// The whole body is encrypted: a welcome email carries a temporary password.
async function queueEmail({ to, name, subject, html, kind, userId }) {
  const job = await prisma.emailJob.create({ data: { toEmail: to, toName: name, subject, htmlEnc: encrypt(html), kind, userId } });
  // Serverless hosts run no background job, so the mail has to leave before the request ends.
  if (process.env.RUN_JOBS === 'false') job.sent = await deliver(job);
  return job;
}

// Test machines hold demo people, some with real-looking addresses, so only listed addresses get real mail there.
const mayDeliver = (to) => process.env.NODE_ENV === 'production' || (process.env.EMAIL_TEST_ALLOW || '').toLowerCase().split(',').map((s) => s.trim()).includes(to.toLowerCase());

async function sendViaBrevo(job, html) {
  const config = await getConfig('brevo');
  if (!config.apiKey || !mayDeliver(job.toEmail)) {
    if (process.env.NODE_ENV === 'production') throw new Error('Brevo API key is not configured');
    if (process.env.NODE_ENV !== 'test') {
      const text = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      console.log(`[email:dev] To ${job.toEmail} | ${job.subject}\n${text}\n`);
    }
    return `dev-${job.id}`;
  }
  // Staff see their own company as the sender, whichever address the mail goes out from.
  const company = await prisma.company.findUnique({ where: { id: job.companyId } });
  const senderName = company && !company.isPlatform ? company.name : config.senderName || 'NkashHeaven-HR';
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': config.apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: config.senderEmail || 'no-reply@nkashheaven.co.za', name: senderName },
      to: [{ email: job.toEmail, name: job.toName || undefined }],
      subject: job.subject,
      htmlContent: html,
      tags: [job.kind],
    }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).messageId || null;
}

async function deliver(job) {
  try {
    const providerId = await sendViaBrevo(job, decrypt(job.htmlEnc));
    await prisma.emailJob.update({ where: { id: job.id }, data: { status: 'SENT', sentAt: new Date(), providerId, attempts: job.attempts + 1, lastError: null } });
    return true;
  } catch (err) {
    const attempts = job.attempts + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    await prisma.emailJob.update({
      where: { id: job.id },
      data: {
        attempts, lastError: err.message.slice(0, 500), status: failed ? 'FAILED' : 'PENDING',
        nextAttempt: new Date(Date.now() + 30000 * 2 ** attempts),
      },
    });
    if (failed && job.kind === 'welcome' && job.userId) {
      await prisma.user.update({ where: { id: job.userId }, data: { inviteStatus: 'BOUNCED' } });
    }
    return false;
  }
}

async function processEmailQueue(limit = 25) {
  const jobs = await prisma.emailJob.findMany({
    where: { status: 'PENDING', nextAttempt: { lte: new Date() } }, orderBy: { id: 'asc' }, take: limit,
  });
  let sent = 0;
  for (const job of jobs) {
    if (await deliver(job)) sent += 1;
  }
  return { processed: jobs.length, sent };
}

// Brevo webhook: opens move the invite to Opened, bounces flag it so HR can fix the address (ONB-05, ONB-06).
async function handleBrevoEvent(event) {
  const messageId = event['message-id'] || event.messageId;
  if (!messageId) return;
  const job = await prisma.emailJob.findFirst({ where: { providerId: messageId } });
  if (!job) return;
  const type = event.event;
  if (['hard_bounce', 'soft_bounce', 'blocked', 'invalid_email', 'spam'].includes(type)) {
    await prisma.emailJob.update({ where: { id: job.id }, data: { status: 'BOUNCED', lastError: type } });
    if (job.kind === 'welcome' && job.userId) await prisma.user.update({ where: { id: job.userId }, data: { inviteStatus: 'BOUNCED' } });
  } else if (['opened', 'unique_opened', 'proxy_open', 'click'].includes(type) && job.kind === 'welcome' && job.userId) {
    await prisma.user.updateMany({ where: { id: job.userId, inviteStatus: 'SENT' }, data: { inviteStatus: 'OPENED' } });
  }
}

module.exports = {
  TEMPLATES, getTemplate, fill, companyUrl, brand, welcomeHtml, resetHtml, notificationHtml, meetingHtml, payslipHtml, queueEmail, processEmailQueue, handleBrevoEvent, clientUrl,
};
