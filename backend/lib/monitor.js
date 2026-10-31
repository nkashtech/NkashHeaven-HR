const prisma = require('./prisma');
const { queueEmail, notificationHtml } = require('./email');
const { superAdminIds } = require('./access');
const { notify } = require('./notify');
const { getSettings } = require('./settings');

// In-memory samples for the current minute; flushed to MetricBucket by the jobs loop.
const BUCKET_MS = 60000;
let current = { requests: 0, errors: 0, times: [], checkInTimes: [] };

const p95 = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
};

function requestMetrics(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    if (!req.originalUrl.startsWith('/api')) return;
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    current.requests += 1;
    current.times.push(ms);
    if (req.originalUrl.startsWith('/api/attendance/check-')) current.checkInTimes.push(ms);
    if (res.statusCode >= 500) current.errors += 1;
  });
  next();
}

async function flushMetrics() {
  const bucket = current;
  current = { requests: 0, errors: 0, times: [], checkInTimes: [] };
  const bucketAt = new Date(Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS);
  await prisma.metricBucket.upsert({
    where: { bucketAt },
    create: { bucketAt, requests: bucket.requests, errors: bucket.errors, p95Ms: Math.round(p95(bucket.times)), checkInP95Ms: Math.round(p95(bucket.checkInTimes)) },
    update: { requests: { increment: bucket.requests }, errors: { increment: bucket.errors } },
  });
}

// Same endpoint and message within the hour rolls into one row with a count (SYS-03).
async function logError(endpoint, message, status) {
  try {
    const short = String(message).slice(0, 1000);
    const recent = await prisma.errorLog.findFirst({ where: { endpoint, message: short, lastAt: { gte: new Date(Date.now() - 3600000) } } });
    if (recent) await prisma.errorLog.update({ where: { id: recent.id }, data: { count: { increment: 1 }, lastAt: new Date() } });
    else await prisma.errorLog.create({ data: { endpoint, message: short, status } });
  } catch (err) {
    console.error('could not log error', err);
  }
}

async function raiseAlert(key, service, message) {
  const open = await prisma.alert.findFirst({ where: { key, status: { in: ['OPEN', 'ACKNOWLEDGED'] } } });
  if (open) return open;
  const alert = await prisma.alert.create({ data: { key, service, message } });
  const settings = await getSettings();
  const ids = await superAdminIds();
  await notify(ids, { type: 'system.alert', title: `${service}: alert`, body: message, link: '/system' });
  for (const to of settings.system.alertEmails || []) {
    await queueEmail({ to, subject: `NkashHeaven-HR alert: ${service}`, html: await notificationHtml({ title: `${service}: alert`, body: message, link: '/system' }), kind: 'system.alert' });
  }
  return alert;
}

async function resolveAlert(key) {
  await prisma.alert.updateMany({ where: { key, status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
}

// SYS-04: error rate above 1% for 5 minutes, or a job failing three runs in a row.
async function evaluateAlerts() {
  const since = new Date(Date.now() - 5 * 60000);
  const buckets = await prisma.metricBucket.findMany({ where: { bucketAt: { gte: since } } });
  const requests = buckets.reduce((s, b) => s + b.requests, 0);
  const errors = buckets.reduce((s, b) => s + b.errors, 0);
  if (requests >= 20 && errors / requests > 0.01) await raiseAlert('error_rate', 'API', `Error rate is ${((errors / requests) * 100).toFixed(1)}% over the last 5 minutes.`);
  else await resolveAlert('error_rate');

  for (const [name, service] of [['calendar_sync', 'Calendar sync worker'], ['email_queue', 'Email queue'], ['backup', 'Backups']]) {
    const runs = await prisma.jobRun.findMany({ where: { name, endedAt: { not: null } }, orderBy: { startedAt: 'desc' }, take: name === 'backup' ? 1 : 3 });
    const failing = runs.length >= (name === 'backup' ? 1 : 3) && runs.every((r) => r.ok === false);
    if (failing) await raiseAlert(`job:${name}`, service, runs[0].detail || `${service} is failing.`);
    else await resolveAlert(`job:${name}`);
  }
}

module.exports = { requestMetrics, flushMetrics, logError, raiseAlert, resolveAlert, evaluateAlerts, p95 };
