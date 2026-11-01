const express = require('express');
const prisma = require('../../lib/prisma');
const { HttpError, h } = require('../middleware/validation');
const { getSettings } = require('../../lib/settings');
const { readFile } = require('../../lib/storage');
const { runAs, asPlatform } = require('../../lib/tenant');
const jwt = require('jsonwebtoken');
const { sha256 } = require('../../lib/crypto');
const meetings = require('../../lib/meetings');

const router = express.Router();

const companyBy = (slug) => prisma.company.findUnique({ where: { slug } });

// Needed before sign-in, so each company's login shows its own look.
router.get('/:slug/branding', h(async (req, res) => {
  const company = await companyBy(req.params.slug);
  if (!company || company.isPlatform) return res.status(404).json({ error: 'Company not found' });
  return runAs(company.id, async () => {
    const { branding } = await getSettings();
    res.json({ name: company.name, slug: company.slug, active: company.active, primaryColor: branding.primaryColor, hasLogo: Boolean(branding.logoFileId) });
  });
}));

// Answering from the email needs no sign-in: the private link stands in for it. A click only ever happens on this page, not when a mail scanner opens the link.
async function withInvite(token, fn) {
  const invite = await asPlatform(async () => await prisma.meetingInvite.findUnique({ where: { tokenHash: sha256(token) } }));
  if (!invite) throw new HttpError(404, 'This invitation is no longer valid');
  return runAs(invite.companyId, async () => fn(invite, await prisma.companyEvent.findUnique({ where: { id: invite.eventId } })));
}

const inviteView = async (invite, event) => {
  const organiser = await prisma.user.findUnique({ where: { id: event.createdById }, select: { name: true } });
  return { title: event.title, when: await meetings.when(event), location: event.location, description: event.description, type: meetings.LABELS[event.meetingType], organiser: organiser?.name, link: await meetings.joinLink(event), status: invite.status };
};

router.get('/meeting-invite/:token', h(async (req, res) => withInvite(req.params.token, async (invite, event) => res.json(await inviteView(invite, event)))));

router.post('/meeting-invite/:token', h(async (req, res) => withInvite(req.params.token, async (invite, event) => {
  const person = await prisma.user.findUnique({ where: { id: invite.userId }, select: { name: true } });
  const status = req.body.answer === 'accept' ? 'ACCEPTED' : 'DECLINED';
  await meetings.respond(invite, event, status, person.name);
  res.json(await inviteView({ ...invite, status }, event));
})));

// Decline on a call notification. The app may be closed, so the signed link stands in for a session.
router.post('/call-decline/:token', h(async (req, res) => {
  let payload;
  try { payload = jwt.verify(req.params.token, process.env.JWT_SECRET); } catch { throw new HttpError(404, 'This call has ended'); }
  if (payload.purpose !== 'call-decline') throw new HttpError(404, 'This call has ended');
  const call = await asPlatform(async () => await prisma.call.findUnique({ where: { id: payload.callId } }));
  if (!call) throw new HttpError(404, 'This call has ended');
  await runAs(call.companyId, async () => {
    if (!call.endedAt) await require('./chat').declineCall(call, payload.userId);
  });
  res.json({ ok: true });
}));

async function sendImage(res, id) {
  const file = id ? await prisma.fileObject.findUnique({ where: { id: Number(id) } }) : null;
  const data = file?.purpose === 'branding' ? await readFile(file) : null;
  if (!data) return res.sendStatus(404);
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.send(data);
}

// Logos and email images are public on purpose: mail clients fetch them with no session.
router.get('/:slug/logo/:kind', h(async (req, res) => {
  const company = await companyBy(req.params.slug);
  if (!company) return res.sendStatus(404);
  return runAs(company.id, async () => {
    const { branding } = await getSettings();
    return sendImage(res, req.params.kind === 'payslip' ? branding.payslipLogoFileId || branding.logoFileId : branding.logoFileId);
  });
}));

router.get('/:slug/image/:id', h(async (req, res) => {
  const company = await companyBy(req.params.slug);
  if (!company) return res.sendStatus(404);
  return runAs(company.id, () => sendImage(res, req.params.id));
}));

// What a phone shows when someone scans a card: enough to confirm it's genuine, nothing more.
router.get('/card/:token', h(async (req, res) => {
  const user = await asPlatform(() => prisma.user.findUnique({ where: { cardToken: req.params.token } }));
  if (!user?.active) return res.status(404).json({ error: 'This card is not valid' });
  const company = await prisma.company.findUnique({ where: { id: user.companyId } });
  res.json({ name: user.name, jobTitle: user.jobTitle, company: company.name, valid: true });
}));

module.exports = router;
