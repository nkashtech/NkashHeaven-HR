const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const zlib = require('zlib');
const prisma = require('./prisma');
const { getSettings } = require('./settings');

const DIR = path.join(__dirname, '..', 'backups');

function dbParts() {
  const url = new URL(process.env.DATABASE_URL);
  return { host: url.hostname, port: url.port || '3306', user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1) };
}

// Daily mysqldump, gzipped, kept for the retention window (FRD §7).
async function runBackup(triggeredBy) {
  fs.mkdirSync(DIR, { recursive: true });
  const run = await prisma.backupRun.create({ data: { triggeredBy } });
  const db = dbParts();
  const fileName = `nkash-hr-${new Date().toISOString().replace(/[:.]/g, '-')}.sql.gz`;
  const target = path.join(DIR, fileName);
  try {
    await new Promise((resolve, reject) => {
      const dump = spawn('mysqldump', ['-h', db.host, '-P', db.port, '-u', db.user, '--single-transaction', '--no-tablespaces', db.database], {
        env: { ...process.env, MYSQL_PWD: db.password },
      });
      let stderr = '';
      dump.stderr.on('data', (d) => { stderr += d; });
      dump.on('error', reject);
      const out = fs.createWriteStream(target);
      dump.stdout.pipe(zlib.createGzip()).pipe(out);
      let code = null;
      dump.on('close', (c) => { code = c; });
      out.on('finish', () => (code === 0 || code === null ? resolve() : reject(new Error(stderr.slice(0, 400) || `mysqldump exited ${code}`))));
    });
    const sizeBytes = fs.statSync(target).size;
    await prisma.backupRun.update({ where: { id: run.id }, data: { ok: true, endedAt: new Date(), sizeBytes, fileName } });
    await prune();
    return { ok: true, fileName, sizeBytes };
  } catch (err) {
    fs.rmSync(target, { force: true });
    await prisma.backupRun.update({ where: { id: run.id }, data: { ok: false, endedAt: new Date(), detail: err.message.slice(0, 500) } });
    throw err;
  }
}

async function prune() {
  const { system } = await getSettings();
  const cutoff = Date.now() - system.backupRetentionDays * 86400000;
  for (const f of fs.readdirSync(DIR)) {
    const full = path.join(DIR, f);
    if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full);
  }
}

module.exports = { runBackup };
