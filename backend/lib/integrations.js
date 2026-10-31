const prisma = require('./prisma');
const { encrypt, decrypt } = require('./crypto');
const { currentCompanyId } = require('./tenant');

// Fields per provider and the env var that backs each one. A value saved by the Super Admin wins over env.
const PROVIDERS = {
  brevo: { label: 'Brevo email', fields: { apiKey: 'BREVO_API_KEY', senderEmail: 'BREVO_SENDER_EMAIL', senderName: 'BREVO_SENDER_NAME' }, secret: ['apiKey'] },
  google: { label: 'Google Calendar', fields: { clientId: 'GOOGLE_CLIENT_ID', clientSecret: 'GOOGLE_CLIENT_SECRET' }, secret: ['clientSecret'] },
  clickup: { label: 'ClickUp', fields: { apiToken: 'CLICKUP_API_TOKEN' }, secret: ['apiToken'] },
  microsoft: { label: 'Microsoft 365', fields: { clientId: 'MICROSOFT_CLIENT_ID', clientSecret: 'MICROSOFT_CLIENT_SECRET' }, secret: ['clientSecret'] },
};

// ClickUp tokens belong to a company; email and calendar apps are shared by the platform.
async function ownerId(provider) {
  if (provider === 'clickup' && currentCompanyId()) return currentCompanyId();
  return (await prisma.company.findFirst({ where: { isPlatform: true } })).id;
}

async function getConfig(provider) {
  const def = PROVIDERS[provider];
  const row = await prisma.integration.findUnique({ where: { companyId_provider: { companyId: await ownerId(provider), provider } } });
  const saved = row?.configEnc ? JSON.parse(decrypt(row.configEnc)) : {};
  const out = {};
  for (const [field, env] of Object.entries(def.fields)) out[field] = saved[field] || process.env[env] || '';
  return out;
}

async function isConfigured(provider) {
  const config = await getConfig(provider);
  if (provider === 'brevo') return Boolean(config.apiKey);
  if (provider === 'clickup') return Boolean(config.apiToken);
  return Boolean(config.clientId && config.clientSecret);
}

async function saveConfig(provider, patch) {
  const current = await getConfig(provider);
  const next = { ...current };
  for (const field of Object.keys(PROVIDERS[provider].fields)) {
    if (patch[field]) next[field] = patch[field];
  }
  const companyId = await ownerId(provider);
  await prisma.integration.upsert({
    where: { companyId_provider: { companyId, provider } },
    create: { companyId, provider, configEnc: encrypt(JSON.stringify(next)) },
    update: { configEnc: encrypt(JSON.stringify(next)) },
  });
}

async function listIntegrations() {
  return Promise.all(Object.entries(PROVIDERS).map(async ([provider, def]) => {
    const config = await getConfig(provider);
    const values = {};
    for (const field of Object.keys(def.fields)) {
      values[field] = def.secret.includes(field) ? (config[field] ? '••••••••' : '') : config[field];
    }
    return { provider, label: def.label, configured: await isConfigured(provider), values };
  }));
}

module.exports = { PROVIDERS, getConfig, isConfigured, saveConfig, listIntegrations };
