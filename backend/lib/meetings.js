const { formatInTimeZone } = require('date-fns-tz');
const prisma = require('./prisma');
const { sha256, randomToken } = require('./crypto');
const { getSettings } = require('./settings');
const { brand, clientUrl, companyUrl, meetingHtml, queueEmail } = require('./email');
const { notify } = require('./notify');

// A company-wide invite is many emails, and a serverless request only lasts seconds, so they go out in small groups at once.
const EMAIL_BATCH = 10;
const LABELS = { APP: 'In-app call', GOOGLE: 'Google Meet', TEAMS: 'Microsoft Teams', LINK: 'Online meeting', NONE: 'In person' };

const joinLink = async (event) => (event.meetingUrl?.startsWith('/') ? companyUrl(await brand(), event.meetingUrl) : event.meetingUrl || null);

async function when(event) {
  const { timezone } = await getSettings();
  return `${formatInTimeZone(event.startAt, timezone, 'EEE d MMM yyyy, HH:mm')}–${formatInTimeZone(event.endAt, timezone, 'HH:mm')}`;
}

async function sendInvites(event, organiserName, people) {
  const details = { title: event.title, when: await when(event), location: event.location, description: event.description, organiser: organiserName, kind: LABELS[event.meetingType], joinUrl: await joinLink(event) };
  const invites = people.map((person) => ({ person, token: randomToken() }));
  await prisma.meetingInvite.createMany({ data: invites.map(({ person, token }) => ({ eventId: event.id, userId: person.id, tokenHash: sha256(token) })) });
  for (let i = 0; i < invites.length; i += EMAIL_BATCH) {
    await Promise.all(invites.slice(i, i + EMAIL_BATCH).map(async ({ person, token }) => queueEmail({
      to: person.email, name: person.name, subject: `Meeting invite: ${event.title}`, kind: 'calendar.invite', userId: person.id,
      html: await meetingHtml({ ...details, name: person.name, acceptUrl: `${clientUrl()}/meeting-invite/${token}?answer=accept`, declineUrl: `${clientUrl()}/meeting-invite/${token}?answer=decline` }),
    })));
  }
  await notify(people.map((p) => p.id), { type: 'calendar.invite', title: `${organiserName} invited you to ${event.title}`, body: details.when, link: '/calendar', inAppOnly: true });
}

async function respond(invite, event, status, name) {
  await prisma.meetingInvite.update({ where: { id: invite.id }, data: { status, respondedAt: new Date() } });
  await notify(event.createdById, { type: 'calendar.response', title: `${name} ${status === 'ACCEPTED' ? 'accepted' : 'declined'} ${event.title}`, link: '/calendar', inAppOnly: true });
}

async function cancelInvites(event, organiserName) {
  const invites = await prisma.meetingInvite.findMany({ where: { eventId: event.id } });
  const ids = invites.filter((i) => i.status !== 'DECLINED').map((i) => i.userId);
  await prisma.meetingInvite.deleteMany({ where: { eventId: event.id } });
  await notify(ids, { type: 'calendar.cancelled', title: `${organiserName} cancelled ${event.title}`, body: await when(event), link: '/calendar' });
}

module.exports = { sendInvites, respond, cancelInvites, joinLink, when, LABELS };
