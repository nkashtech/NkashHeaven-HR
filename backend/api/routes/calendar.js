const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../../lib/prisma');
const { authenticate, requirePerm } = require('../middleware/auth');
const { HttpError, h, required, intParam, dateParam } = require('../middleware/validation');
const { getSettings } = require('../../lib/settings');
const { can } = require('../../lib/permissions');
const { audit } = require('../../lib/audit');
const { teamIds, isAdmin } = require('../../lib/access');
const { notify } = require('../../lib/notify');
const { isConfigured } = require('../../lib/integrations');
const { clientUrl } = require('../../lib/email');
const { asPlatform, runAs } = require('../../lib/tenant');
const calendar = require('../../lib/calendar');
const chat = require('../../lib/chat');
const meetings = require('../../lib/meetings');
const { zonedToUtc, toDbDate, fromDbDate, today, addDays, eachDay, yearOf } = require('../../lib/time');

const router = express.Router();

const COLOURS = { GOOGLE: '#2F62E3', MICROSOFT: '#7C3AED', leave: '#E2744A', holiday: '#B34D22', birthday: '#E2744A', company: '#3D9A8B', teamleave: '#F0B49A' };

const MAX_IN_APP = 6;
const MEETING_TYPES = ['NONE', 'APP', 'GOOGLE', 'TEAMS', 'LINK'];

function companyEventVisible(e, user) {
  if (e.createdById === user.id || e.audience === 'COMPANY') return true;
  if (e.audience === 'DEPARTMENT') return e.departmentId === user.departmentId;
  return (e.attendeeIds || []).includes(user.id);
}

async function eventsFor(user, fromStr, toStr, tz) {
  const fromUtc = zonedToUtc(fromStr, '00:00', tz);
  const toUtc = zonedToUtc(addDays(toStr, 1), '00:00', tz);
  const [synced, company, myInvites, holidays, leave] = await Promise.all([
    prisma.syncedEvent.findMany({ where: { userId: user.id, startAt: { lt: toUtc }, endAt: { gt: fromUtc } }, include: { connection: { select: { provider: true } } } }),
    prisma.companyEvent.findMany({ where: { startAt: { lt: toUtc }, endAt: { gt: fromUtc } } }),
    prisma.meetingInvite.findMany({ where: { userId: user.id } }),
    prisma.publicHoliday.findMany({ where: { date: { gte: toDbDate(fromStr), lte: toDbDate(toStr) } } }),
    prisma.leaveRequest.findMany({
      where: { state: { in: ['APPROVED', 'PARTLY_APPROVED', 'SUBMITTED'] }, dateFrom: { lte: toDbDate(toStr) }, dateTo: { gte: toDbDate(fromStr) }, OR: [{ userId: user.id }, user.departmentId ? { user: { departmentId: user.departmentId } } : { userId: user.id }] },
      include: { user: { select: { name: true } }, leaveType: { select: { name: true } } },
    }),
  ]);
  const events = [
    ...synced.map((e) => ({
      id: `s${e.id}`, source: e.connection.provider === 'GOOGLE' ? 'google' : 'microsoft', colour: COLOURS[e.connection.provider], title: e.title, start: e.startAt, end: e.endAt,
      allDay: e.allDay, location: e.location, meetingUrl: e.meetingUrl, attendeeCount: e.attendeeCount, isPrivate: e.isPrivate,
    })),
    ...company.filter((e) => companyEventVisible(e, user)).map((e) => ({
      id: `c${e.id}`, source: 'company', colour: COLOURS.company, title: e.title, start: e.startAt, end: e.endAt, allDay: false, location: e.location, meetingUrl: e.meetingUrl,
      description: e.description, attendeeCount: (e.attendeeIds || []).length, editable: e.createdById === user.id,
      meetingType: e.meetingType, myResponse: myInvites.find((i) => i.eventId === e.id)?.status || null,
    })),
    ...holidays.map((x) => ({ id: `h${x.id}`, source: 'holiday', colour: COLOURS.holiday, title: x.kind === 'OFFICE' ? `${x.name} (office closed)` : x.name, date: fromDbDate(x.date), allDay: true })),
  ];
  for (const l of leave) {
    const mine = l.userId === user.id;
    if (!mine && l.state !== 'APPROVED') continue;
    eachDay(fromDbDate(l.dateFrom) < fromStr ? fromStr : fromDbDate(l.dateFrom), fromDbDate(l.dateTo) > toStr ? toStr : fromDbDate(l.dateTo)).forEach((date) => {
      events.push({
        id: `l${l.id}-${date}`, source: mine ? 'leave' : 'teamleave', colour: mine ? COLOURS.leave : COLOURS.teamleave, title: `${mine ? 'You' : l.user.name} · ${l.leaveType.name}${l.state === 'APPROVED' ? '' : ' (pending)'}`, date, allDay: true,
      });
    });
  }
  const birthdays = await prisma.profile.findMany({ where: { birthDate: { not: null }, user: { active: true, showBirthday: true, role: { not: 'SUPER_ADMIN' } } }, include: { user: { select: { name: true } } } });
  const years = [...new Set([yearOf(fromStr), yearOf(toStr)])];
  for (const b of birthdays) {
    for (const year of years) {
      const date = `${year}-${fromDbDate(b.birthDate).slice(5)}`;
      if (date >= fromStr && date <= toStr) events.push({ id: `b${b.userId}-${year}`, source: 'birthday', colour: COLOURS.birthday, title: `${b.user.name}'s birthday`, date, allDay: true });
    }
  }
  return events;
}

// Provider redirect lands here without an API token; the signed state says who it's for.
router.get('/callback/:provider', h(async (req, res) => {
  const back = (q) => res.redirect(`${clientUrl()}/settings?tab=calendar&${q}`);
  if (req.query.error) return back('calendar=denied');
  try {
    const state = jwt.verify(String(req.query.state), process.env.JWT_SECRET);
    if (state.purpose !== 'calendar' || state.provider.toLowerCase() !== req.params.provider) throw new Error('Bad state');
    await runAs(state.companyId, () => calendar.connectFromCode(state.provider, state.userId, String(req.query.code), { write: Boolean(state.write), meetings: Boolean(state.meetings) }));
    return back('calendar=connected');
  } catch (err) {
    console.error('calendar connect failed', err.message);
    return back('calendar=error');
  }
}));

// CAL-03 push. Unknown channels are acknowledged and ignored; the secret-free webhook only ever triggers a re-read.
router.post('/webhook/google', h(async (req, res) => {
  const channelId = req.headers['x-goog-channel-id'];
  const connection = channelId ? await asPlatform(() => prisma.calendarConnection.findUnique({ where: { channelId } })) : null;
  res.sendStatus(200);
  if (connection?.status === 'CONNECTED') await runAs(connection.companyId, () => calendar.syncConnection(connection));
}));

router.post('/webhook/microsoft', h(async (req, res) => {
  if (req.query.validationToken) return res.type('text/plain').send(String(req.query.validationToken));
  res.sendStatus(202);
  for (const note of req.body?.value || []) {
    const connection = note.clientState ? await asPlatform(() => prisma.calendarConnection.findUnique({ where: { channelId: note.clientState } })) : null;
    if (connection?.status === 'CONNECTED') await runAs(connection.companyId, () => calendar.syncConnection(connection));
  }
  return undefined;
}));

router.use(authenticate);
router.use(requirePerm('module.calendar'));
router.use(h(async (req, res, next) => {
  const { system } = await getSettings();
  if (!system.flags.calendar) throw new HttpError(403, 'Calendar is switched off for this company');
  next();
}));

router.get('/events', h(async (req, res) => {
  const { timezone: tz } = await getSettings();
  res.json({ events: await eventsFor(req.user, dateParam(req.query.from, 'from'), dateParam(req.query.to, 'to'), tz) });
}));

// CAL-05: today's remaining meetings, soonest first.
router.get('/today', h(async (req, res) => {
  const { timezone: tz } = await getSettings();
  const day = today(tz);
  const events = await eventsFor(req.user, day, day, tz);
  const now = new Date();
  const meetings = events
    .filter((e) => !e.allDay && new Date(e.end) > now)
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .slice(0, 3);
  const connection = await prisma.calendarConnection.findFirst({ where: { userId: req.user.id }, orderBy: { lastSyncAt: 'desc' } });
  res.json({ meetings, syncedFrom: connection ? { accountEmail: connection.accountEmail, lastSyncAt: connection.lastSyncAt } : null, serverNow: now });
}));

router.get('/connections', h(async (req, res) => {
  const rows = await prisma.calendarConnection.findMany({ where: { userId: req.user.id } });
  const view = async (provider) => {
    const c = rows.find((r) => r.provider === provider);
    return {
      provider, available: await isConfigured(provider.toLowerCase()), connected: Boolean(c), id: c?.id, status: c?.status || null,
      pushLeave: Boolean(c?.pushLeave), accountEmail: c?.accountEmail || null, lastSyncAt: c?.lastSyncAt || null, lastError: c?.lastError || null,
    };
  };
  res.json({ connections: [await view('GOOGLE')] });
}));

router.get('/connect/:provider', h(async (req, res) => {
  const provider = req.params.provider.toUpperCase();
  if (!['GOOGLE', 'MICROSOFT'].includes(provider)) throw new HttpError(400, 'Unknown provider');
  // One connection covers the calendar and creating Meet links, so nobody is asked twice.
  const url = await calendar.authUrl(provider, req.user.id, { write: req.query.write === '1', meetings: true });
  if (!url) throw new HttpError(503, 'This calendar is not set up yet. Ask the Super Admin to configure it under Integrations.');
  res.json({ url });
}));

router.post('/connections/:id/sync', h(async (req, res) => {
  const connection = await prisma.calendarConnection.findFirst({ where: { id: intParam(req.params.id), userId: req.user.id } });
  if (!connection) throw new HttpError(404, 'Connection not found');
  res.json({ ok: await calendar.syncConnection(connection) });
}));

router.delete('/connections/:id', h(async (req, res) => {
  const connection = await prisma.calendarConnection.findFirst({ where: { id: intParam(req.params.id), userId: req.user.id } });
  if (!connection) throw new HttpError(404, 'Connection not found');
  await calendar.disconnect(connection);
  await audit(req, { entity: 'CalendarConnection', entityId: connection.id, action: 'calendar.disconnected', after: { provider: connection.provider } });
  res.json({ ok: true });
}));

// CAL-06: blocks only, never titles.
router.get('/team-busy', requirePerm('calendar.team_busy'), h(async (req, res) => {
  const { timezone: tz } = await getSettings();
  const from = dateParam(req.query.from, 'from');
  const to = dateParam(req.query.to, 'to');
  const ids = await teamIds(req.user);
  const users = await prisma.user.findMany({ where: { active: true, id: ids === null ? undefined : { in: ids } }, select: { id: true, name: true }, take: 200, orderBy: { name: 'asc' } });
  const events = await prisma.syncedEvent.findMany({
    where: { userId: { in: users.map((u) => u.id) }, startAt: { lt: zonedToUtc(addDays(to, 1), '00:00', tz) }, endAt: { gt: zonedToUtc(from, '00:00', tz) } },
    select: { userId: true, startAt: true, endAt: true },
  });
  res.json({ people: users.map((u) => ({ ...u, busy: events.filter((e) => e.userId === u.id).map((e) => ({ start: e.startAt, end: e.endAt })) })) });
}));

// "New meeting" in the Calendar screen
router.post('/meetings', h(async (req, res) => {
  required(req.body, ['title', 'date', 'from', 'to']);
  const { timezone: tz } = await getSettings();
  const date = dateParam(req.body.date);
  const startAt = zonedToUtc(date, req.body.from, tz);
  const endAt = zonedToUtc(date, req.body.to, tz);
  if (endAt <= startAt) throw new HttpError(400, 'The meeting must end after it starts');
  const audience = req.body.audience || 'PEOPLE';
  if (audience === 'COMPANY' && !(await can(req.user, 'calendar.company_events'))) throw new HttpError(403, 'Only HR can create company-wide events');
  if (audience === 'DEPARTMENT' && !isAdmin(req.user) && !(await teamIds(req.user)).length) throw new HttpError(403, 'Only leaders can invite a whole department');
  const meetingType = MEETING_TYPES.includes(req.body.meetingType) ? req.body.meetingType : req.body.meetingUrl ? 'LINK' : 'NONE';
  const attendeeIds = (req.body.attendeeIds || []).map(Number);
  const departmentId = audience === 'DEPARTMENT' ? Number(req.body.departmentId || req.user.departmentId) : null;
  const where = { active: true, id: { not: req.user.id }, role: { not: 'SUPER_ADMIN' } };
  if (audience === 'PEOPLE') where.id = { in: attendeeIds.filter((id) => id !== req.user.id) };
  if (audience === 'DEPARTMENT') where.departmentId = departmentId;
  const people = await prisma.user.findMany({ where, select: { id: true, name: true, email: true } });
  if (!people.length && meetingType !== 'NONE') throw new HttpError(400, 'Choose who to invite');

  let meetingUrl = meetingType === 'LINK' ? req.body.meetingUrl : null;
  let conversationId = null;
  if (meetingType === 'LINK' && !/^https:\/\//.test(meetingUrl || '')) throw new HttpError(400, 'Enter the full meeting link');
  if (meetingType === 'APP') {
    if (people.length + 1 > MAX_IN_APP) throw new HttpError(400, `In-app meetings can have up to ${MAX_IN_APP} people. Use Google Meet or Teams for bigger ones.`);
    const conversation = people.length === 1
      ? await chat.directConversation(req.user.id, people[0].id)
      : await prisma.conversation.create({ data: { type: 'GROUP', name: String(req.body.title).slice(0, 80), createdById: req.user.id, members: { create: [req.user.id, ...people.map((p) => p.id)].map((userId) => ({ userId })) } } });
    conversationId = conversation.id;
    meetingUrl = `/chat?c=${conversationId}&join=1`;
  }
  if (meetingType === 'GOOGLE' || meetingType === 'TEAMS') {
    meetingUrl = await calendar.onlineMeetingFor(req.user, meetingType === 'GOOGLE' ? 'GOOGLE' : 'MICROSOFT', { title: req.body.title, startAt, endAt });
  }
  const event = await prisma.companyEvent.create({
    data: {
      title: req.body.title, description: req.body.description, startAt, endAt, location: req.body.location, meetingUrl, meetingType, conversationId, audience,
      departmentId, attendeeIds: people.map((p) => p.id), createdById: req.user.id,
    },
  });
  await meetings.sendInvites(event, req.user.name, people);
  await audit(req, { entity: 'CompanyEvent', entityId: event.id, action: 'event.created', after: { title: event.title, audience, meetingType } });
  res.status(201).json({ id: event.id, meetingUrl });
}));

router.get('/meetings/:id', h(async (req, res) => {
  const event = await prisma.companyEvent.findUnique({ where: { id: intParam(req.params.id) } });
  if (!event || !companyEventVisible(event, req.user)) throw new HttpError(404, 'Event not found');
  const invites = await prisma.meetingInvite.findMany({ where: { eventId: event.id } });
  const users = await prisma.user.findMany({ where: { id: { in: [event.createdById, ...invites.map((i) => i.userId)] } }, select: { id: true, name: true } });
  const nameOf = (id) => users.find((u) => u.id === id)?.name || 'Former employee';
  res.json({
    organiser: nameOf(event.createdById), link: await meetings.joinLink(event), type: meetings.LABELS[event.meetingType],
    attendees: invites.map((i) => ({ id: i.userId, name: nameOf(i.userId), status: i.status })),
  });
}));

router.post('/meetings/:id/respond', h(async (req, res) => {
  const id = intParam(req.params.id);
  const invite = await prisma.meetingInvite.findUnique({ where: { eventId_userId: { eventId: id, userId: req.user.id } } });
  if (!invite) throw new HttpError(404, 'You are not invited to this meeting');
  const event = await prisma.companyEvent.findUnique({ where: { id } });
  await meetings.respond(invite, event, req.body.answer === 'accept' ? 'ACCEPTED' : 'DECLINED', req.user.name);
  res.json({ ok: true });
}));

router.delete('/meetings/:id', h(async (req, res) => {
  const id = intParam(req.params.id);
  const event = await prisma.companyEvent.findUnique({ where: { id } });
  if (!event) throw new HttpError(404, 'Event not found');
  if (event.createdById !== req.user.id && !isAdmin(req.user)) throw new HttpError(403, 'Only the organiser can remove this');
  await meetings.cancelInvites(event, req.user.name);
  await prisma.companyEvent.delete({ where: { id } });
  await audit(req, { entity: 'CompanyEvent', entityId: id, action: 'event.deleted', before: { title: event.title } });
  res.json({ ok: true });
}));

module.exports = router;
