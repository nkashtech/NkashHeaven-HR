const prisma = require('./prisma');
const { emitToUsers } = require('./realtime');
const { queueEmail, notificationHtml } = require('./email');
const { asPlatform, runAs, currentCompanyId } = require('./tenant');

// Notification groups a user can tune in Settings (NTF-03). The part of `type` before the dot is the group.
const GROUPS = {
  approvals: { label: 'Approvals', email: true },
  profile: { label: 'Profile changes', email: false },
  onboarding: { label: 'Invites and onboarding', email: true },
  attendance: { label: 'Attendance', email: true },
  timesheet: { label: 'Timesheet reminders', email: true },
  birthday: { label: 'Birthdays', email: false },
  calendar: { label: 'Calendar sync', email: true },
  system: { label: 'System alerts', email: true },
  chat: { label: 'Chat', email: false },
  tagged: { label: 'Tagged on work (tasks, timesheets)', email: false },
  payroll: { label: 'Payslips and contracts', email: true },
  appraisal: { label: 'Appraisals', email: true },
};

function prefsFor(user, group) {
  const defaults = { inApp: true, email: GROUPS[group]?.email ?? false };
  return { ...defaults, ...(user.notifyPrefs?.[group] || {}) };
}

// Sends to in-app and email per each user's preferences. Never throws: a notification must not fail the action.
async function notify(userIds, { type, title, body, link, payload }) {
  const ids = [...new Set([].concat(userIds).filter(Boolean))];
  if (!ids.length) return;
  try {
    const group = type.split('.')[0];
    // System alerts reach Super Admins, who sit in the platform company, so look up across companies then write in each person's own.
    const users = await asPlatform(() => prisma.user.findMany({
      where: { id: { in: ids }, active: true }, select: { id: true, name: true, email: true, notifyPrefs: true, companyId: true },
    }));
    const from = currentCompanyId();
    for (const user of users.filter((u) => !from || u.companyId === from || group === 'system')) {
      await runAs(user.companyId, async () => {
        const prefs = prefsFor(user, group);
        if (prefs.inApp) {
          const row = await prisma.notification.create({ data: { userId: user.id, type, title, body, link, payload } });
          emitToUsers([user.id], 'notification', row);
        }
        if (prefs.email) {
          await queueEmail({ to: user.email, name: user.name, subject: title, html: await notificationHtml({ title, body, link }), kind: type, userId: user.id });
        }
      });
    }
  } catch (err) {
    console.error('notify failed', err);
  }
}

module.exports = { notify, GROUPS, prefsFor };
