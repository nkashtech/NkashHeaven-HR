const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const prisma = require('../../lib/prisma');
const { authenticate, requirePerm } = require('../middleware/auth');
const { HttpError, h, intParam } = require('../middleware/validation');
const { getSettings } = require('../../lib/settings');
const { audit } = require('../../lib/audit');
const { clientUrl } = require('../../lib/email');
const { can } = require('../../lib/permissions');

const router = express.Router();
router.use(authenticate);

// The QR is a link, so a phone camera can confirm the card and a kiosk reads the token from its end.
async function cardFor(userId) {
  let user = await prisma.user.findUnique({ where: { id: userId }, include: { department: { select: { name: true } }, profile: { select: { photoFileId: true } } } });
  if (!user) throw new HttpError(404, 'Employee not found');
  if (!user.cardToken) user = await prisma.user.update({ where: { id: userId }, data: { cardToken: crypto.randomBytes(18).toString('base64url') }, include: { department: { select: { name: true } }, profile: { select: { photoFileId: true } } } });
  const { card, branding, companyName, slug } = await getSettings();
  const qr = await QRCode.toDataURL(`${clientUrl()}/card/${user.cardToken}`, { margin: 1, width: 360, errorCorrectionLevel: 'M' });
  return { design: { ...card, logoFileId: card.logoFileId || branding.logoFileId || null }, companyName, slug, qr, token: user.cardToken, person: { id: user.id, name: user.name, jobTitle: user.jobTitle, department: user.department?.name || null, employeeNo: user.employeeNo, photoFileId: user.profile?.photoFileId || null } };
}

router.get('/me', requirePerm('module.card'), h(async (req, res) => res.json(await cardFor(req.user.id))));

router.get('/:id', h(async (req, res) => {
  const id = intParam(req.params.id);
  if (id !== req.user.id && !(await can(req.user, 'users.manage'))) throw new HttpError(403, 'You do not have access to this card');
  res.json(await cardFor(id));
}));

// A lost card stops working the moment HR reissues it.
router.post('/:id/reissue', requirePerm('users.manage'), h(async (req, res) => {
  const id = intParam(req.params.id);
  await prisma.user.update({ where: { id }, data: { cardToken: crypto.randomBytes(18).toString('base64url') } });
  await audit(req, { entity: 'User', entityId: id, action: 'card.reissued' });
  res.json(await cardFor(id));
}));

module.exports = router;
