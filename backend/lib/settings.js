const prisma = require('./prisma');
const { today, addDays, monthStart } = require('./time');
const { currentCompanyId } = require('./tenant');

const DEFAULTS = {
  attendance: { lockDate: null, graceMinutes: 10, autoCheckoutHours: 4 },
  timesheets: { roundingMinutes: 15, allowLogOnLeave: true, reminderDay: 5, reminderHour: 15, workflowId: null },
  security: {
    minPasswordLength: 8, sessionIdleHours: 8, adminTwoFactorRequired: true, ipAllowlist: [],
    lockoutAttempts: 5, lockoutMinutes: 15,
  },
  chat: { retentionMonths: 12 },
  system: {
    maintenance: false,
    maintenanceMessage: 'NkashHeaven-HR is down for maintenance. Please try again shortly.',
    flags: { chat: true, calendar: true, celebrations: true },
    backupRetentionDays: 30,
    alertEmails: [],
  },
  branding: {
    logoFileId: null, payslipLogoFileId: null, primaryColor: '#B34D22', address: 'Johannesburg, South Africa', registrationNo: '',
    emailFooter: 'Sent on behalf of your employer',
  },
  // The employee card design. Sizes are millimetres; a credit card is 85.6 by 54.
  card: {
    widthMm: 85.6, heightMm: 54, radiusMm: 3, backgroundColor: '#FFFFFF', textColor: '#18181B', accentColor: '#B34D22', backgroundImageId: null, logoFileId: null,
    title: 'Employee card', showJobTitle: true, showDepartment: true, showEmployeeNo: true, showPhoto: true, footerText: '', qrSizeMm: 22,
  },
  // Defaults are the 2025/26 SARS tables. Finance must confirm them each tax year under Payroll settings.
  payroll: {
    taxYear: '2025/26', currency: 'R',
    brackets: [
      { upTo: 237100, base: 0, rate: 18 }, { upTo: 370500, base: 42678, rate: 26 }, { upTo: 512800, base: 77362, rate: 31 },
      { upTo: 673000, base: 121475, rate: 36 }, { upTo: 857900, base: 179147, rate: 39 }, { upTo: 1817000, base: 251258, rate: 41 }, { upTo: null, base: 644489, rate: 45 },
    ],
    rebatePrimary: 17235, rebateSecondary: 9444, rebateTertiary: 3145, uifRate: 1, uifCeiling: 17712, sdlRate: 1,
  },
  appraisal: {
    employeeTemplate: 'What went well this period?\n\nWhat was hard, and what support would help?\n\nWhat do you want to focus on next?',
    managerTemplate: 'Strengths shown this period:\n\nAreas to improve:\n\nAgreed goals for next period:',
  },
};

const cache = new Map();

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] ? merge(base[k], v) : v;
  }
  return out;
}

async function platformCompany() {
  return prisma.company.findFirst({ where: { isPlatform: true } });
}

async function resolveId() {
  const id = currentCompanyId();
  return id ?? (await platformCompany())?.id;
}

async function getCompany() {
  return prisma.company.findUnique({ where: { id: await resolveId() } });
}

async function getSettings() {
  const id = await resolveId();
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 5000) return hit.value;
  const [company, platform] = await Promise.all([getCompany(), platformCompany()]);
  const value = {
    ...merge(DEFAULTS, company?.settings), companyId: id, companyName: company?.name || 'NkashHeaven', slug: company?.slug || null, timezone: company?.timezone || 'Africa/Johannesburg', seats: company?.seats || 100,
    // Maintenance and alerts belong to the whole platform; everything else to the company.
    platform: merge(DEFAULTS.system, platform?.settings?.system),
  };
  cache.set(id, { at: Date.now(), value });
  return value;
}

async function updateSettings(section, patch) {
  const company = await getCompany();
  const current = company?.settings || {};
  const settings = { ...current, [section]: merge(current[section] || {}, patch) };
  await prisma.company.update({ where: { id: company.id }, data: { settings } });
  cache.clear();
  return getSettings();
}

// BR-03: unless HR sets one, the lock date is the 3rd of this month (previous month end + 3 days grace).
function effectiveLockDate(settings, tz) {
  if (settings.attendance.lockDate) return settings.attendance.lockDate;
  const now = today(tz);
  const thisMonth = addDays(monthStart(now), 2);
  return now >= thisMonth ? thisMonth : addDays(monthStart(addDays(monthStart(now), -1)), 2);
}

const clearSettingsCache = () => cache.clear();

module.exports = { DEFAULTS, platformCompany, getCompany, getSettings, updateSettings, effectiveLockDate, clearSettingsCache };
