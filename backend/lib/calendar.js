const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const prisma = require('./prisma');
const { encrypt, decrypt } = require('./crypto');
const { getConfig } = require('./integrations');
const { notify } = require('./notify');
const { superAdminIds } = require('./access');
const { emitToUsers } = require('./realtime');
const { currentCompanyId } = require('./tenant');

// Read-only scopes only (CAL-02). OAuth is the same consent screen a phone calendar uses; no password is ever stored.
const GOOGLE_SCOPES = 'openid email https://www.googleapis.com/auth/calendar.readonly';
const MS_SCOPES = 'offline_access User.Read Calendars.Read';
// Only asked for when someone opts in to pushing approved leave out (CAL-08).
const GOOGLE_WRITE = 'https://www.googleapis.com/auth/calendar.events';
const MS_WRITE = 'Calendars.ReadWrite';
const PAST_DAYS = 30;
const FUTURE_DAYS = 90;

const apiUrl = () => process.env.API_URL || 'http://localhost:3011';
const redirectUri = (provider) => `${apiUrl()}/api/calendar/callback/${provider.toLowerCase()}`;
const isHttps = () => apiUrl().startsWith('https://');

class TokenRevoked extends Error {}

async function authUrl(provider, userId, { write = false } = {}) {
  const config = await getConfig(provider.toLowerCase());
  if (!config.clientId) return null;
  const state = jwt.sign({ userId, provider, write, companyId: currentCompanyId(), purpose: 'calendar' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  if (provider === 'GOOGLE') {
    const q = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirectUri(provider), response_type: 'code', scope: write ? `${GOOGLE_SCOPES} ${GOOGLE_WRITE}` : GOOGLE_SCOPES, access_type: 'offline', prompt: 'consent', state });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }
  const q = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirectUri(provider), response_type: 'code', scope: write ? `${MS_SCOPES} ${MS_WRITE}` : MS_SCOPES, state, prompt: 'select_account' });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${q}`;
}

async function tokenRequest(provider, params) {
  const config = await getConfig(provider.toLowerCase());
  const url = provider === 'GOOGLE' ? 'https://oauth2.googleapis.com/token' : 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
  const res = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...params }),
  });
  const data = await res.json();
  if (!res.ok) {
    if (data.error === 'invalid_grant') throw new TokenRevoked(data.error_description || 'invalid_grant');
    throw new Error(data.error_description || data.error || `Token request failed (${res.status})`);
  }
  return data;
}

async function accessTokenFor(connection) {
  const data = await tokenRequest(connection.provider, { grant_type: 'refresh_token', refresh_token: decrypt(connection.refreshEnc) });
  // Microsoft rotates refresh tokens.
  if (data.refresh_token) {
    await prisma.calendarConnection.update({ where: { id: connection.id }, data: { refreshEnc: encrypt(data.refresh_token) } });
  }
  return data.access_token;
}

async function connectFromCode(provider, userId, code, { write = false } = {}) {
  const tokens = await tokenRequest(provider, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(provider) });
  let accountEmail = null;
  if (provider === 'GOOGLE' && tokens.id_token) {
    accountEmail = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString()).email;
  } else if (provider === 'MICROSOFT') {
    const me = await (await fetch('https://graph.microsoft.com/v1.0/me', { headers: { authorization: `Bearer ${tokens.access_token}` } })).json();
    accountEmail = me.mail || me.userPrincipalName;
  }
  const refreshEnc = encrypt(tokens.refresh_token);
  const connection = await prisma.calendarConnection.upsert({
    where: { userId_provider: { userId, provider } },
    create: { userId, provider, accountEmail, refreshEnc, pushLeave: write },
    update: { accountEmail, refreshEnc, status: 'CONNECTED', lastError: null, syncToken: null, pushLeave: write },
  });
  await syncConnection(connection);
  await subscribePush(connection).catch((err) => console.warn('calendar push subscribe failed:', err.message));
  return connection;
}

const meetingUrlFrom = (text) => (String(text || '').match(/https:\/\/[^\s"<>]*(?:zoom\.us|teams\.microsoft\.com|meet\.google\.com)[^\s"<>]*/) || [])[0] || null;

function normaliseGoogle(e) {
  const allDay = Boolean(e.start?.date);
  const isPrivate = e.visibility === 'private' || e.visibility === 'confidential';
  return {
    externalId: e.id,
    title: isPrivate ? 'Busy' : e.summary || '(No title)',
    startAt: new Date(e.start?.dateTime || `${e.start?.date}T00:00:00Z`),
    endAt: new Date(e.end?.dateTime || `${e.end?.date}T00:00:00Z`),
    allDay,
    location: isPrivate ? null : e.location || null,
    meetingUrl: isPrivate ? null : e.hangoutLink || e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri || meetingUrlFrom(e.location) || meetingUrlFrom(e.description),
    attendeeCount: isPrivate ? 0 : (e.attendees || []).length,
    isPrivate,
  };
}

function normaliseMicrosoft(e) {
  const isPrivate = e.sensitivity === 'private' || e.sensitivity === 'confidential';
  return {
    externalId: e.id,
    title: isPrivate ? 'Busy' : e.subject || '(No title)',
    startAt: new Date(`${e.start.dateTime}Z`),
    endAt: new Date(`${e.end.dateTime}Z`),
    allDay: Boolean(e.isAllDay),
    location: isPrivate ? null : e.location?.displayName || null,
    meetingUrl: isPrivate ? null : e.onlineMeeting?.joinUrl || e.onlineMeetingUrl || meetingUrlFrom(e.location?.displayName),
    attendeeCount: isPrivate ? 0 : (e.attendees || []).length,
    isPrivate,
  };
}

async function applyEvents(connection, events) {
  for (const { event, removed } of events) {
    if (removed) {
      await prisma.syncedEvent.deleteMany({ where: { connectionId: connection.id, externalId: event.externalId } });
      continue;
    }
    if (Number.isNaN(event.startAt.getTime())) continue;
    await prisma.syncedEvent.upsert({
      where: { connectionId_externalId: { connectionId: connection.id, externalId: event.externalId } },
      create: { ...event, connectionId: connection.id, userId: connection.userId },
      update: event,
    });
  }
}

async function googleSync(connection, token) {
  const collected = [];
  let pageToken;
  let nextSyncToken = null;
  do {
    const q = new URLSearchParams({ singleEvents: 'true', maxResults: '250' });
    if (connection.syncToken) q.set('syncToken', connection.syncToken);
    else {
      q.set('timeMin', new Date(Date.now() - PAST_DAYS * 86400000).toISOString());
      q.set('timeMax', new Date(Date.now() + FUTURE_DAYS * 86400000).toISOString());
    }
    if (pageToken) q.set('pageToken', pageToken);
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, { headers: { authorization: `Bearer ${token}` } });
    if (res.status === 410) {
      // Sync token expired: start over with a full window.
      await prisma.calendarConnection.update({ where: { id: connection.id }, data: { syncToken: null } });
      return googleSync({ ...connection, syncToken: null }, token);
    }
    if (!res.ok) throw new Error(`Google Calendar ${res.status}`);
    const data = await res.json();
    (data.items || []).forEach((e) => collected.push({ event: e.status === 'cancelled' ? { externalId: e.id } : normaliseGoogle(e), removed: e.status === 'cancelled' }));
    pageToken = data.nextPageToken;
    nextSyncToken = data.nextSyncToken || nextSyncToken;
  } while (pageToken);
  await applyEvents(connection, collected);
  return nextSyncToken;
}

async function microsoftSync(connection, token) {
  const start = new Date(Date.now() - PAST_DAYS * 86400000).toISOString();
  const end = new Date(Date.now() + FUTURE_DAYS * 86400000).toISOString();
  let url = `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${start}&endDateTime=${end}&$top=200&$select=id,subject,start,end,isAllDay,location,onlineMeeting,onlineMeetingUrl,attendees,sensitivity`;
  const seen = [];
  while (url) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, prefer: 'outlook.timezone="UTC"' } });
    if (!res.ok) throw new Error(`Microsoft Graph ${res.status}`);
    const data = await res.json();
    data.value.forEach((e) => seen.push(normaliseMicrosoft(e)));
    url = data['@odata.nextLink'];
  }
  await applyEvents(connection, seen.map((event) => ({ event })));
  await prisma.syncedEvent.deleteMany({ where: { connectionId: connection.id, externalId: { notIn: seen.map((e) => e.externalId) } } });
  return null;
}

// CAL-07: a revoked token flips the account to Reconnect and tells the user and the Super Admin, once.
async function syncConnection(connection) {
  try {
    const token = await accessTokenFor(connection);
    const syncToken = connection.provider === 'GOOGLE' ? await googleSync(connection, token) : await microsoftSync(connection, token);
    await prisma.calendarConnection.update({
      where: { id: connection.id }, data: { lastSyncAt: new Date(), lastError: null, status: 'CONNECTED', syncToken: syncToken ?? connection.syncToken },
    });
    emitToUsers([connection.userId], 'calendar:synced', { connectionId: connection.id });
    return true;
  } catch (err) {
    if (err instanceof TokenRevoked) {
      const wasConnected = connection.status === 'CONNECTED';
      await prisma.calendarConnection.update({ where: { id: connection.id }, data: { status: 'RECONNECT', lastError: err.message.slice(0, 500) } });
      if (wasConnected) {
        const label = connection.provider === 'GOOGLE' ? 'Google' : 'Microsoft';
        await notify(connection.userId, { type: 'calendar.reconnect', title: `Reconnect your ${label} calendar`, body: 'Access expired, so your meetings have stopped syncing.', link: '/settings?tab=calendar' });
        await notify(await superAdminIds(), { type: 'system.calendar_token', title: `${label} calendar token expired`, body: `${connection.accountEmail || 'An account'} needs to reconnect.`, link: '/system/integrations' });
      }
    } else {
      await prisma.calendarConnection.update({ where: { id: connection.id }, data: { lastError: err.message.slice(0, 500) } });
    }
    return false;
  }
}

// CAL-03 push channels. Both providers require a public HTTPS callback, so this is a no-op on localhost.
async function subscribePush(connection) {
  if (!isHttps()) return;
  const token = await accessTokenFor(connection);
  if (connection.provider === 'GOOGLE') {
    const id = crypto.randomUUID();
    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events/watch', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id, type: 'web_hook', address: `${apiUrl()}/api/calendar/webhook/google` }),
    });
    if (!res.ok) throw new Error(`Google watch ${res.status}`);
    const data = await res.json();
    await prisma.calendarConnection.update({ where: { id: connection.id }, data: { channelId: id, channelResource: data.resourceId, channelExpiry: new Date(Number(data.expiration)) } });
    return;
  }
  const clientState = crypto.randomUUID();
  const expiry = new Date(Date.now() + 2.5 * 86400000);
  const res = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ changeType: 'created,updated,deleted', notificationUrl: `${apiUrl()}/api/calendar/webhook/microsoft`, resource: 'me/events', expirationDateTime: expiry.toISOString(), clientState }),
  });
  if (!res.ok) throw new Error(`Graph subscription ${res.status}`);
  const data = await res.json();
  await prisma.calendarConnection.update({ where: { id: connection.id }, data: { channelId: clientState, channelResource: data.id, channelExpiry: expiry } });
}

async function disconnect(connection) {
  // Best effort: the local data goes even if the provider can't be reached.
  try {
    if (connection.provider === 'GOOGLE') {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decrypt(connection.refreshEnc))}`, { method: 'POST' });
    }
  } catch { /* already revoked */ }
  await prisma.syncedEvent.deleteMany({ where: { connectionId: connection.id } });
  await prisma.calendarConnection.delete({ where: { id: connection.id } });
}

// One-way "Out of office" events for approved leave. Failures never affect the approval itself.
async function pushLeave(request) {
  const connections = await prisma.calendarConnection.findMany({ where: { userId: request.userId, pushLeave: true, status: 'CONNECTED' } });
  const pushed = [];
  const start = request.dateFrom.toISOString().slice(0, 10);
  const end = new Date(request.dateTo.getTime() + 86400000).toISOString().slice(0, 10);
  for (const c of connections) {
    try {
      const token = await accessTokenFor(c);
      const res = c.provider === 'GOOGLE'
        ? await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ summary: 'Out of office', start: { date: start }, end: { date: end }, transparency: 'opaque' }),
        })
        : await fetch('https://graph.microsoft.com/v1.0/me/events', {
          method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ subject: 'Out of office', isAllDay: true, showAs: 'oof', start: { dateTime: `${start}T00:00:00`, timeZone: 'UTC' }, end: { dateTime: `${end}T00:00:00`, timeZone: 'UTC' } }),
        });
      if (res.ok) pushed.push({ connectionId: c.id, eventId: (await res.json()).id });
    } catch (err) {
      console.warn('leave push failed:', err.message);
    }
  }
  if (pushed.length) await prisma.leaveRequest.update({ where: { id: request.id }, data: { pushedEvents: pushed } });
}

async function removePushedLeave(request) {
  for (const p of request.pushedEvents || []) {
    try {
      const c = await prisma.calendarConnection.findUnique({ where: { id: p.connectionId } });
      if (!c) continue;
      const token = await accessTokenFor(c);
      const url = c.provider === 'GOOGLE' ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${p.eventId}` : `https://graph.microsoft.com/v1.0/me/events/${p.eventId}`;
      await fetch(url, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    } catch (err) {
      console.warn('leave unpush failed:', err.message);
    }
  }
  if (request.pushedEvents) await prisma.leaveRequest.update({ where: { id: request.id }, data: { pushedEvents: null } });
}

async function syncAll() {
  const connections = await prisma.calendarConnection.findMany({ where: { status: 'CONNECTED' } });
  let ok = 0;
  for (const connection of connections) {
    if (await syncConnection(connection)) ok += 1;
    if (connection.channelExpiry && connection.channelExpiry < new Date(Date.now() + 86400000)) {
      await subscribePush(connection).catch(() => {});
    }
  }
  return { accounts: connections.length, ok };
}

module.exports = { authUrl, connectFromCode, syncConnection, disconnect, syncAll, subscribePush, normaliseGoogle, normaliseMicrosoft, pushLeave, removePushedLeave };
