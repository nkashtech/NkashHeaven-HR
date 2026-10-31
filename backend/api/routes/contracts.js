const express = require('express');
const prisma = require('../../lib/prisma');
const { authenticate, requirePerm } = require('../middleware/auth');
const { HttpError, h, required, intParam, dateParam } = require('../middleware/validation');
const { audit } = require('../../lib/audit');
const { notify } = require('../../lib/notify');
const { toDbDate, fromDbDate } = require('../../lib/time');

const router = express.Router();
router.use(authenticate);
const manage = requirePerm('contracts.manage');

const optDate = (v) => (v ? toDbDate(dateParam(v)) : null);
const view = (c) => ({
  ...c, startDate: fromDbDate(c.startDate), endDate: c.endDate ? fromDbDate(c.endDate) : null, probationEnd: c.probationEnd ? fromDbDate(c.probationEnd) : null,
  workPermitExpiry: c.workPermitExpiry ? fromDbDate(c.workPermitExpiry) : null, userName: c.user?.name, user: undefined,
});

router.get('/my', h(async (req, res) => {
  const rows = await prisma.contract.findMany({ where: { userId: req.user.id, state: { not: 'DRAFT' } }, orderBy: { startDate: 'desc' } });
  res.json({ contracts: rows.map(view) });
}));

router.get('/', manage, h(async (req, res) => {
  const rows = await prisma.contract.findMany({
    where: { state: req.query.state || undefined, userId: req.query.userId ? Number(req.query.userId) : undefined },
    include: { user: { select: { name: true } } }, orderBy: [{ state: 'asc' }, { startDate: 'desc' }],
  });
  res.json({ contracts: rows.map(view) });
}));

const fields = (b) => ({
  reference: b.reference, contractType: b.contractType, jobTitle: b.jobTitle, wage: b.wage === undefined ? undefined : Number(b.wage), notes: b.notes, workPermitNumber: b.workPermitNumber,
  documentFileId: b.documentFileId === undefined ? undefined : b.documentFileId ? Number(b.documentFileId) : null,
  startDate: b.startDate ? toDbDate(dateParam(b.startDate)) : undefined, endDate: b.endDate === undefined ? undefined : optDate(b.endDate),
  probationEnd: b.probationEnd === undefined ? undefined : optDate(b.probationEnd), workPermitExpiry: b.workPermitExpiry === undefined ? undefined : optDate(b.workPermitExpiry),
});

router.post('/', manage, h(async (req, res) => {
  required(req.body, ['userId', 'startDate', 'wage']);
  const userId = intParam(req.body.userId, 'userId');
  if (!(Number(req.body.wage) > 0)) throw new HttpError(400, 'Wage must be more than zero');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(404, 'Employee not found');
  const count = await prisma.contract.count({ where: { userId } });
  const contract = await prisma.contract.create({
    data: { ...fields(req.body), userId, reference: req.body.reference || `${user.employeeNo}/C${count + 1}`, jobTitle: req.body.jobTitle || user.jobTitle, createdById: req.user.id },
  });
  await audit(req, { entity: 'Contract', entityId: contract.id, action: 'contract.created', after: { userId, reference: contract.reference } });
  res.status(201).json({ contract: view(contract) });
}));

router.patch('/:id', manage, h(async (req, res) => {
  const id = intParam(req.params.id);
  const before = await prisma.contract.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, 'Contract not found');
  if (['EXPIRED', 'CANCELLED'].includes(before.state)) throw new HttpError(423, 'A closed contract cannot be changed');
  const contract = await prisma.contract.update({ where: { id }, data: fields(req.body) });
  await audit(req, { entity: 'Contract', entityId: id, action: 'contract.updated', before: { wage: before.wage, endDate: before.endDate }, after: { wage: contract.wage, endDate: contract.endDate } });
  res.json({ contract: view(contract) });
}));

// Starting a contract closes any other running one: an employee has one at a time.
router.post('/:id/start', manage, h(async (req, res) => {
  const id = intParam(req.params.id);
  const contract = await prisma.contract.findUnique({ where: { id } });
  if (!contract) throw new HttpError(404, 'Contract not found');
  if (contract.state !== 'DRAFT') throw new HttpError(409, 'Only a draft can be started');
  await prisma.$transaction([
    prisma.contract.updateMany({ where: { userId: contract.userId, state: 'RUNNING' }, data: { state: 'EXPIRED' } }),
    prisma.contract.update({ where: { id }, data: { state: 'RUNNING' } }),
  ]);
  await audit(req, { entity: 'Contract', entityId: id, action: 'contract.started' });
  await notify(contract.userId, { type: 'payroll.contract', title: 'Your employment contract is active', link: '/profile' });
  res.json({ state: 'RUNNING' });
}));

router.post('/:id/close', manage, h(async (req, res) => {
  const id = intParam(req.params.id);
  const contract = await prisma.contract.findUnique({ where: { id } });
  if (!contract) throw new HttpError(404, 'Contract not found');
  const state = contract.state === 'DRAFT' ? 'CANCELLED' : 'EXPIRED';
  await prisma.contract.update({ where: { id }, data: { state } });
  await audit(req, { entity: 'Contract', entityId: id, action: 'contract.closed', after: { state } });
  res.json({ state });
}));

module.exports = router;
