const express = require('express');
const prisma = require('../../lib/prisma');
const { authenticate, requirePerm } = require('../middleware/auth');
const { HttpError, h, required, intParam, isDate } = require('../middleware/validation');
const { encrypt, decrypt, mask } = require('../../lib/crypto');
const { audit } = require('../../lib/audit');
const { adminIds, canAccessUser, isAdmin } = require('../../lib/access');
const { can } = require('../../lib/permissions');
const { notify } = require('../../lib/notify');
const { toDbDate, fromDbDate } = require('../../lib/time');

const router = express.Router();
router.use(authenticate);

// PRF-02: saved at once, HR told with old and new values.
const INSTANT = {
  preferredName: 'Preferred name', salutation: 'Salutation', pronoun: 'Pronoun', gender: 'Gender', nationality: 'Nationality', bloodGroup: 'Blood group', religion: 'Religion', race: 'Race', maritalStatus: 'Marital status',
  idExpiry: 'ID expiry date', permitExpiry: 'Permit expiry date',
  phone: 'Mobile number', homePhone: 'Home phone', officePhone: 'Office phone', personalEmail: 'Personal email',
  address: 'Permanent address', city: 'City', state: 'State', zipCode: 'Zip code', country: 'Country', contactNumber: 'Contact number',
  presentAddress: 'Present address', presentCity: 'Present city', presentState: 'Present state', presentZip: 'Present zip code', presentCountry: 'Present country', presentContact: 'Present contact number',
  emergencyName: 'Emergency contact name', emergencyRelation: 'Emergency contact relationship', emergencyPhone: 'Emergency contact phone', emergencyEmail: 'Emergency contact email',
  dependents: 'Dependents', workExperience: 'Work experience', qualifications: 'Qualifications', memberships: 'Memberships', photoFileId: 'Photo', signatureFileId: 'eSignature',
};
const DATE_FIELDS = ['idExpiry', 'permitExpiry'];
const LIST_FIELDS = ['dependents', 'workExperience', 'qualifications', 'memberships'];
const show = (v) => (v === null || v === undefined ? null : v instanceof Date ? fromDbDate(v) : typeof v === 'object' ? JSON.stringify(v) : String(v));
const stored = (field, v) => {
  if (v === '' || v === null) return null;
  if (DATE_FIELDS.includes(field)) { if (!isDate(v)) throw new HttpError(400, `${INSTANT[field]} must be a date`); return toDbDate(v); }
  return v;
};
// PRF-03: held in a change request until HR approves. Values with `enc` are stored encrypted.
const SENSITIVE = {
  legalName: { label: 'Legal name' },
  birthDate: { label: 'Date of birth' },
  idNumber: { label: 'ID number', enc: 'idNumberEnc' },
  taxNumber: { label: 'Tax number', enc: 'taxNumberEnc' },
  bankName: { label: 'Bank' },
  bankAccount: { label: 'Account number', enc: 'bankAccountEnc' },
  bankAccountType: { label: 'Account type' },
  passportNumber: { label: 'Passport number', enc: 'passportNumberEnc' },
};

// HR setting or correcting someone's record directly. No change request: HR is the approver.
async function saveHrProfile(userId, body) {
  const data = {};
  for (const field of Object.keys(INSTANT)) if (body[field] !== undefined) data[field] = stored(field, body[field]);
  for (const [field, def] of Object.entries(SENSITIVE)) {
    if (body[field] === undefined || body[field] === '') continue;
    if (def.enc) data[def.enc] = encrypt(body[field]);
    else if (field === 'birthDate') { if (!isDate(body[field])) throw new HttpError(400, 'Date of birth must be a date'); data.birthDate = toDbDate(body[field]); } else data[field] = body[field];
  }
  await prisma.profile.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

function sensitiveValue(profile, field) {
  const def = SENSITIVE[field];
  if (def.enc) return decrypt(profile?.[def.enc]);
  if (field === 'birthDate') return profile?.birthDate ? fromDbDate(profile.birthDate) : null;
  return profile?.[field] ?? null;
}

function birthdayMonthDay(d) {
  return d ? new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(d) : null;
}

async function profileView(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: true, department: { select: { name: true } }, team: { select: { name: true } }, manager: { select: { name: true } }, schedule: { select: { name: true } },
    },
  });
  if (!user) throw new HttpError(404, 'Person not found');
  const p = user.profile || {};
  return {
    id: user.id, name: user.name, email: user.email, employeeNo: user.employeeNo, jobTitle: user.jobTitle, role: user.role,
    department: user.department?.name || null, team: user.team?.name || null, manager: user.manager?.name || null, schedule: user.schedule?.name || null,
    startDate: fromDbDate(user.startDate), salaryBand: user.salaryBand,
    legalName: p.legalName || user.name, preferredName: p.preferredName || '', birthDate: p.birthDate ? fromDbDate(p.birthDate) : '', birthday: birthdayMonthDay(p.birthDate), hasBirthDate: Boolean(p.birthDate),
    idNumber: mask(decrypt(p.idNumberEnc)), taxNumber: mask(decrypt(p.taxNumberEnc)), passportNumber: mask(decrypt(p.passportNumberEnc)), signatureFileId: p.signatureFileId || null,
    ...Object.fromEntries(Object.keys(INSTANT).filter((k) => !['photoFileId', 'signatureFileId', ...LIST_FIELDS].includes(k)).map((k) => [k, (p[k] instanceof Date ? fromDbDate(p[k]) : p[k]) || ''])),
    ...Object.fromEntries(LIST_FIELDS.map((k) => [k, p[k] || []])),
    bankName: p.bankName || '', bankAccount: mask(decrypt(p.bankAccountEnc)), bankAccountType: p.bankAccountType || '', photoFileId: p.photoFileId || null,
  };
}

router.get('/me', h(async (req, res) => res.json({ profile: await profileView(req.user.id) })));

router.get('/me/history', h(async (req, res) => {
  const [changes, requests] = await Promise.all([
    prisma.profileChange.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
    prisma.changeRequest.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
  ]);
  const items = [
    ...changes.map((c) => ({ id: `c${c.id}`, label: `${c.field} updated`, status: 'HR notified', at: c.createdAt })),
    ...requests.map((r) => ({
      id: `r${r.id}`, label: `${r.summary.map((s) => s.label).join(', ')} changed`, at: r.decidedAt || r.createdAt, reason: r.reason,
      status: { PENDING: 'Pending HR', APPROVED: 'Approved by HR', REJECTED: 'Rejected by HR' }[r.status],
    })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));
  res.json({ items });
}));

router.patch('/me', h(async (req, res) => {
  const body = req.body || {};
  const profile = await prisma.profile.upsert({ where: { userId: req.user.id }, create: { userId: req.user.id }, update: {} });

  const instant = {};
  const changes = [];
  for (const [field, label] of Object.entries(INSTANT)) {
    if (body[field] === undefined) continue;
    const value = stored(field, body[field]);
    if (show(profile[field]) === show(value)) continue;
    instant[field] = value;
    changes.push({ field: label, oldValue: show(profile[field]), newValue: show(value) });
  }

  const sensitive = [];
  const payload = {};
  for (const [field, def] of Object.entries(SENSITIVE)) {
    if (body[field] === undefined || body[field] === '') continue;
    if (field === 'birthDate' && !isDate(body[field])) throw new HttpError(400, 'Date of birth must be yyyy-mm-dd');
    const old = sensitiveValue(profile, field);
    if (String(old ?? '') === String(body[field])) continue;
    // A first-time birthday isn't a correction: onboarding step 2 sets it directly (ONB-04).
    if (field === 'birthDate' && !old) {
      instant.birthDate = toDbDate(body[field]);
      continue;
    }
    payload[field] = body[field];
    sensitive.push({ field, label: def.label, oldMasked: def.enc ? mask(old) : old, newMasked: def.enc ? mask(body[field]) : body[field] });
  }

  if (Object.keys(instant).length) {
    await prisma.profile.update({ where: { userId: req.user.id }, data: instant });
  }
  if (changes.length) {
    await prisma.profileChange.createMany({ data: changes.map((c) => ({ ...c, userId: req.user.id, actorId: req.user.id })) });
    await audit(req, { entity: 'Profile', entityId: req.user.id, action: 'profile.updated', before: Object.fromEntries(changes.map((c) => [c.field, c.oldValue])), after: Object.fromEntries(changes.map((c) => [c.field, c.newValue])) });
    const summary = changes.map((c) => `${c.field}: ${c.oldValue || '(empty)'} → ${c.newValue || '(empty)'}`).join('; ');
    await notify(await adminIds(), { type: 'profile.updated', title: `${req.user.name} updated ${changes.map((c) => c.field.toLowerCase()).join(', ')}`, body: summary.slice(0, 900), link: '/hr/requests' });
  }
  let request = null;
  if (sensitive.length) {
    request = await prisma.changeRequest.create({
      data: { userId: req.user.id, summary: sensitive, payloadEnc: encrypt(JSON.stringify(payload)), proofFileId: body.proofFileId ? Number(body.proofFileId) : null },
    });
    await audit(req, { entity: 'ChangeRequest', entityId: request.id, action: 'change_request.created', after: { fields: sensitive.map((s) => s.label) } });
    await notify(await adminIds(), { type: 'profile.change_request', title: `${req.user.name} requested a change to ${sensitive.map((s) => s.label.toLowerCase()).join(', ')}`, body: 'Needs your approval before it takes effect.', link: '/hr/requests' });
  }
  res.json({ profile: await profileView(req.user.id), applied: changes.length, pendingRequest: request ? request.id : null });
}));

// HR views: instant changes to acknowledge, and requests to decide (US-N09).
router.get('/changes', requirePerm('profile.review'), h(async (req, res) => {
  const seen = req.query.seen === 'true';
  const rows = await prisma.profileChange.findMany({ where: { seenAt: seen ? { not: null } : null }, orderBy: { createdAt: 'desc' }, take: 100 });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  res.json({ changes: rows.map((r) => ({ ...r, userName: names.get(r.userId) })) });
}));

router.post('/changes/:id/seen', requirePerm('profile.review'), h(async (req, res) => {
  await prisma.profileChange.update({ where: { id: intParam(req.params.id) }, data: { seenAt: new Date(), seenById: req.user.id } });
  res.json({ ok: true });
}));

router.get('/requests', requirePerm('profile.review'), h(async (req, res) => {
  const status = req.query.status || 'PENDING';
  const rows = await prisma.changeRequest.findMany({ where: { status }, orderBy: { createdAt: 'desc' }, take: 100 });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  res.json({ requests: rows.map(({ payloadEnc, ...r }) => ({ ...r, userName: names.get(r.userId) })) });
}));

router.post('/requests/:id/approve', requirePerm('profile.review'), h(async (req, res) => {
  const id = intParam(req.params.id);
  const row = await prisma.changeRequest.findUnique({ where: { id } });
  if (!row || row.status !== 'PENDING') throw new HttpError(404, 'Request not found');
  if (row.userId === req.user.id) throw new HttpError(403, 'Another HR Admin must approve your own change');
  const payload = JSON.parse(decrypt(row.payloadEnc));
  const data = {};
  for (const [field, value] of Object.entries(payload)) {
    const def = SENSITIVE[field];
    if (def.enc) data[def.enc] = encrypt(value);
    else if (field === 'birthDate') data.birthDate = toDbDate(value);
    else data[field] = value;
  }
  await prisma.$transaction(async (tx) => {
    await tx.profile.update({ where: { userId: row.userId }, data });
    if (payload.legalName) await tx.user.update({ where: { id: row.userId }, data: { name: payload.legalName } });
    await tx.changeRequest.update({ where: { id }, data: { status: 'APPROVED', decidedById: req.user.id, decidedAt: new Date(), payloadEnc: null } });
    await audit(req, { entity: 'ChangeRequest', entityId: id, action: 'change_request.approved', after: { fields: row.summary.map((s) => s.label) } }, tx);
  });
  await notify(row.userId, { type: 'profile.decided', title: 'HR approved your profile change', body: row.summary.map((s) => s.label).join(', '), link: '/profile' });
  res.json({ ok: true });
}));

router.post('/requests/:id/reject', requirePerm('profile.review'), h(async (req, res) => {
  const id = intParam(req.params.id);
  required(req.body, ['reason']);
  const row = await prisma.changeRequest.findUnique({ where: { id } });
  if (!row || row.status !== 'PENDING') throw new HttpError(404, 'Request not found');
  await prisma.changeRequest.update({ where: { id }, data: { status: 'REJECTED', decidedById: req.user.id, decidedAt: new Date(), reason: String(req.body.reason).slice(0, 500), payloadEnc: null } });
  await audit(req, { entity: 'ChangeRequest', entityId: id, action: 'change_request.rejected', after: { reason: req.body.reason } });
  await notify(row.userId, { type: 'profile.decided', title: 'HR rejected your profile change', body: req.body.reason, link: '/profile' });
  res.json({ ok: true });
}));

// Employee documents: contracts, certificates, ID copies.
router.get('/:id/documents', h(async (req, res) => {
  const userId = intParam(req.params.id);
  if (!(await canAccessUser(req.user, userId))) throw new HttpError(403, 'You do not have access to this person');
  const rows = await prisma.employeeDocument.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  res.json({ documents: rows.map((d) => ({ ...d, expiresOn: d.expiresOn ? fromDbDate(d.expiresOn) : null })) });
}));

router.post('/:id/documents', h(async (req, res) => {
  const userId = intParam(req.params.id);
  required(req.body, ['name', 'fileId']);
  if (userId !== req.user.id && !(await can(req.user, 'users.manage'))) throw new HttpError(403, 'You can only add your own documents');
  const doc = await prisma.employeeDocument.create({ data: { userId, name: req.body.name, category: req.body.category || null, fileId: Number(req.body.fileId), expiresOn: req.body.expiresOn && isDate(req.body.expiresOn) ? toDbDate(req.body.expiresOn) : null, createdById: req.user.id } });
  await audit(req, { entity: 'EmployeeDocument', entityId: doc.id, action: 'document.added', after: { userId, name: doc.name } });
  res.status(201).json({ document: doc });
}));

router.delete('/documents/:docId', h(async (req, res) => {
  const id = intParam(req.params.docId, 'document');
  const doc = await prisma.employeeDocument.findUnique({ where: { id } });
  if (!doc) throw new HttpError(404, 'Document not found');
  if (doc.userId !== req.user.id && !(await can(req.user, 'users.manage'))) throw new HttpError(403, 'You cannot remove this document');
  await prisma.employeeDocument.delete({ where: { id } });
  res.json({ ok: true });
}));

router.get('/:id', h(async (req, res) => {
  const id = intParam(req.params.id);
  if (!(await canAccessUser(req.user, id))) throw new HttpError(403, 'You do not have access to this person');
  const profile = await profileView(id);
  // Leaders see job and contact details; ID and bank stay with HR.
  if (!isAdmin(req.user) && id !== req.user.id) {
    for (const key of ['birthDate', 'idNumber', 'taxNumber', 'passportNumber', 'bankName', 'bankAccount', 'bankAccountType', 'salaryBand', 'address', 'presentAddress', 'religion', 'race', 'bloodGroup', 'maritalStatus', 'dependents']) delete profile[key];
  }
  res.json({ profile });
}));

// HR sees a full ID or bank number only on purpose, and that view is audited.
router.post('/:id/reveal', requirePerm('profile.review'), h(async (req, res) => {
  const id = intParam(req.params.id);
  required(req.body, ['field']);
  if (!SENSITIVE[req.body.field]?.enc) throw new HttpError(400, 'That field cannot be revealed');
  const profile = await prisma.profile.findUnique({ where: { userId: id } });
  await audit(req, { entity: 'Profile', entityId: id, action: 'profile.revealed', after: { field: req.body.field } });
  res.json({ value: sensitiveValue(profile, req.body.field) });
}));

module.exports = router;
module.exports.saveHrProfile = saveHrProfile;
