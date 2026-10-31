const express = require('express');
const prisma = require('../../lib/prisma');
const { h } = require('../middleware/validation');
const { getSettings } = require('../../lib/settings');
const { readFile } = require('../../lib/storage');
const { runAs, asPlatform } = require('../../lib/tenant');

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
