const express = require('express');
const PDFDocument = require('pdfkit');
const prisma = require('../../lib/prisma');
const { authenticate, requirePerm } = require('../middleware/auth');
const { HttpError, h, required, intParam, dateParam } = require('../middleware/validation');
const { can } = require('../../lib/permissions');
const { audit } = require('../../lib/audit');
const { notify } = require('../../lib/notify');
const { getSettings, updateSettings } = require('../../lib/settings');
const { queueEmail, payslipHtml } = require('../../lib/email');
const { computePayslip, generateRun } = require('../../lib/payroll');
const { readFile } = require('../../lib/storage');
const { toDbDate, fromDbDate, round2 } = require('../../lib/time');

const router = express.Router();
router.use(authenticate);
const manage = requirePerm('payroll.manage');

const periodName = (d) => new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
const slipView = (p) => ({
  id: p.id, runId: p.runId, number: p.number, userId: p.userId, userName: p.user?.name, employeeNo: p.user?.employeeNo, periodStart: fromDbDate(p.periodStart), periodEnd: fromDbDate(p.periodEnd),
  period: periodName(p.periodStart), workedDays: p.workedDays, unpaidDays: p.unpaidDays, gross: p.gross, deductions: p.deductions, net: p.net, state: p.state,
  lines: p.lines?.sort((a, b) => a.sequence - b.sequence),
});

async function mustBeDraft(runId) {
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new HttpError(404, 'Payroll batch not found');
  if (run.state !== 'DRAFT') throw new HttpError(423, 'This batch is locked. Reset it to draft first.');
  return run;
}

// An employee's own finished payslips
router.get('/my', requirePerm('module.payslips'), h(async (req, res) => {
  const slips = await prisma.payslip.findMany({ where: { userId: req.user.id, state: { in: ['DONE', 'PAID'] } }, include: { user: { select: { name: true, employeeNo: true } } }, orderBy: { periodStart: 'desc' } });
  res.json({ payslips: slips.map(slipView) });
}));

router.get('/settings', manage, h(async (req, res) => {
  const { payroll } = await getSettings();
  res.json({ payroll, rules: await prisma.salaryRule.findMany({ orderBy: { sequence: 'asc' } }) });
}));

router.put('/settings', manage, h(async (req, res) => {
  await updateSettings('payroll', req.body);
  await audit(req, { entity: 'Settings', action: 'settings.payroll_updated', after: req.body });
  res.json({ ok: true });
}));

const ruleData = (b) => ({ code: b.code ? String(b.code).toUpperCase() : undefined, name: b.name, category: b.category, amountType: b.amountType, amount: b.amount === undefined ? undefined : Number(b.amount), sequence: b.sequence === undefined ? undefined : Number(b.sequence), active: b.active });

router.post('/rules', manage, h(async (req, res) => {
  required(req.body, ['code', 'name', 'category']);
  if (['BASIC', 'PAYE', 'UIF', 'NET', 'SDL', 'UNPAID', 'UIF_ER'].includes(String(req.body.code).toUpperCase())) throw new HttpError(409, 'That code is reserved');
  const rule = await prisma.salaryRule.create({ data: ruleData(req.body) });
  await audit(req, { entity: 'SalaryRule', entityId: rule.id, action: 'salary_rule.created', after: rule });
  res.status(201).json({ rule });
}));

router.patch('/rules/:id', manage, h(async (req, res) => {
  const id = intParam(req.params.id);
  const rule = await prisma.salaryRule.update({ where: { id }, data: ruleData(req.body) });
  await audit(req, { entity: 'SalaryRule', entityId: id, action: 'salary_rule.updated', after: rule });
  res.json({ rule });
}));

router.get('/runs', manage, h(async (req, res) => {
  const runs = await prisma.payrollRun.findMany({ orderBy: { periodStart: 'desc' }, include: { payslips: { select: { gross: true, net: true } } } });
  res.json({
    runs: runs.map((r) => ({
      id: r.id, name: r.name, state: r.state, periodStart: fromDbDate(r.periodStart), periodEnd: fromDbDate(r.periodEnd), payslips: r.payslips.length,
      gross: round2(r.payslips.reduce((s, p) => s + p.gross, 0)), net: round2(r.payslips.reduce((s, p) => s + p.net, 0)),
    })),
  });
}));

router.post('/runs', manage, h(async (req, res) => {
  required(req.body, ['periodStart', 'periodEnd']);
  const start = dateParam(req.body.periodStart, 'periodStart');
  const end = dateParam(req.body.periodEnd, 'periodEnd');
  if (end < start) throw new HttpError(400, 'The end date is before the start date');
  const run = await prisma.payrollRun.create({ data: { name: req.body.name || `Payroll ${periodName(toDbDate(start))}`, periodStart: toDbDate(start), periodEnd: toDbDate(end), createdById: req.user.id } });
  const created = await generateRun(run);
  await audit(req, { entity: 'PayrollRun', entityId: run.id, action: 'payroll.run_created', after: { name: run.name, payslips: created } });
  res.status(201).json({ id: run.id, payslips: created });
}));

router.get('/runs/:id', manage, h(async (req, res) => {
  const run = await prisma.payrollRun.findUnique({ where: { id: intParam(req.params.id) } });
  if (!run) throw new HttpError(404, 'Payroll batch not found');
  const slips = await prisma.payslip.findMany({ where: { runId: run.id }, include: { user: { select: { name: true, employeeNo: true } } }, orderBy: { userId: 'asc' } });
  res.json({ run: { ...run, periodStart: fromDbDate(run.periodStart), periodEnd: fromDbDate(run.periodEnd) }, payslips: slips.map(slipView) });
}));

router.post('/runs/:id/recompute', manage, h(async (req, res) => {
  const run = await mustBeDraft(intParam(req.params.id));
  const added = await generateRun(run);
  const slips = await prisma.payslip.findMany({ where: { runId: run.id } });
  for (const s of slips) await computePayslip(s.id);
  res.json({ added, recomputed: slips.length });
}));

// DRAFT → VERIFIED → DONE (published to employees) → PAID
const FLOW = { verify: ['DRAFT', 'VERIFIED'], confirm: ['VERIFIED', 'DONE'], paid: ['DONE', 'PAID'], reset: ['VERIFIED', 'DRAFT'] };

router.post('/runs/:id/:step', manage, h(async (req, res) => {
  const id = intParam(req.params.id);
  const flow = FLOW[req.params.step];
  if (!flow) throw new HttpError(404, 'Unknown step');
  const run = await prisma.payrollRun.findUnique({ where: { id } });
  if (!run) throw new HttpError(404, 'Payroll batch not found');
  if (run.state !== flow[0]) throw new HttpError(409, `This batch is ${run.state.toLowerCase()}`);
  const [, next] = flow;
  await prisma.$transaction([prisma.payrollRun.update({ where: { id }, data: { state: next } }), prisma.payslip.updateMany({ where: { runId: id }, data: { state: next } })]);
  await audit(req, { entity: 'PayrollRun', entityId: id, action: `payroll.${req.params.step}`, before: { state: flow[0] }, after: { state: next } });
  if (next === 'DONE') {
    const slips = await prisma.payslip.findMany({ where: { runId: id }, include: { user: true } });
    const period = periodName(run.periodStart);
    for (const s of slips) {
      await notify(s.userId, { type: 'tagged.payslip', title: `Your payslip for ${period} is ready`, link: '/payslips' });
      const email = await payslipHtml({ name: s.user.name, period });
      await queueEmail({ to: s.user.email, name: s.user.name, subject: email.subject, html: email.html, kind: 'payslip', userId: s.userId });
    }
  }
  res.json({ state: next });
}));

async function readableSlip(req) {
  const slip = await prisma.payslip.findUnique({ where: { id: intParam(req.params.id) }, include: { lines: true, user: { include: { department: true, profile: true } }, contract: true } });
  if (!slip) throw new HttpError(404, 'Payslip not found');
  const hr = await can(req.user, 'payroll.manage');
  const mine = slip.userId === req.user.id && ['DONE', 'PAID'].includes(slip.state) && (await can(req.user, 'module.payslips'));
  if (!hr && !mine) throw new HttpError(403, 'You do not have access to this payslip');
  return slip;
}

router.get('/payslips/:id', h(async (req, res) => res.json({ payslip: slipView(await readableSlip(req)) })));

// Hand-added lines, such as a bonus or a loan repayment
router.post('/payslips/:id/lines', manage, h(async (req, res) => {
  const id = intParam(req.params.id);
  required(req.body, ['name', 'category', 'amount']);
  if (!['ALLOWANCE', 'DEDUCTION'].includes(req.body.category)) throw new HttpError(400, 'A line is an allowance or a deduction');
  const slip = await prisma.payslip.findUnique({ where: { id } });
  if (!slip) throw new HttpError(404, 'Payslip not found');
  await mustBeDraft(slip.runId);
  await prisma.payslipLine.create({ data: { payslipId: id, code: 'MANUAL', name: req.body.name, category: req.body.category, amount: Number(req.body.amount), sequence: 50, manual: true } });
  await computePayslip(id);
  await audit(req, { entity: 'Payslip', entityId: id, action: 'payslip.line_added', after: req.body });
  res.status(201).json({ ok: true });
}));

router.delete('/payslips/:id/lines/:lineId', manage, h(async (req, res) => {
  const id = intParam(req.params.id);
  const slip = await prisma.payslip.findUnique({ where: { id } });
  if (!slip) throw new HttpError(404, 'Payslip not found');
  await mustBeDraft(slip.runId);
  await prisma.payslipLine.deleteMany({ where: { id: intParam(req.params.lineId), payslipId: id, manual: true } });
  await computePayslip(id);
  res.json({ ok: true });
}));

const money = (cur, n) => `${cur} ${Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

router.get('/payslips/:id/pdf', h(async (req, res) => {
  const slip = await readableSlip(req);
  const { branding, companyName, payroll } = await getSettings();
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="payslip-${slip.number.replace(/\//g, '-')}.pdf"`);
  doc.pipe(res);
  const logoId = branding.payslipLogoFileId || branding.logoFileId;
  const logo = logoId ? await prisma.fileObject.findUnique({ where: { id: logoId } }) : null;
  let top = 50;
  // PDFKit reads PNG and JPEG only; any other logo falls back to the company name.
  const logoData = logo && ['image/png', 'image/jpeg'].includes(logo.mime) ? await readFile(logo) : null;
  if (logoData) {
    doc.image(logoData, 50, top, { fit: [150, 50] });
  } else doc.font('Helvetica-Bold').fontSize(18).fillColor('#1a1a1a').text(companyName, 50, top);
  doc.font('Helvetica').fontSize(9).fillColor('#555').text([companyName, branding.address, branding.registrationNo ? `Reg. ${branding.registrationNo}` : null].filter(Boolean).join('\n'), 350, top, { width: 195, align: 'right' });
  top = 115;
  doc.font('Helvetica-Bold').fontSize(16).fillColor(branding.primaryColor).text('Payslip', 50, top);
  doc.font('Helvetica').fontSize(10).fillColor('#1a1a1a').text(`${periodName(slip.periodStart)} · ${slip.number}`, 50, top + 22);
  top += 48;
  // Payslips are legal documents, so they carry the full name rather than the display name.
  const legal = await prisma.profile.findUnique({ where: { userId: slip.userId }, select: { legalName: true } });
  const info = [['Employee', legal?.legalName || slip.user.name], ['Employee no.', slip.user.employeeNo], ['Job title', slip.contract.jobTitle || slip.user.jobTitle || ''], ['Department', slip.user.department?.name || ''], ['Period', `${fromDbDate(slip.periodStart)} to ${fromDbDate(slip.periodEnd)}`], ['Worked days', String(slip.workedDays)]];
  info.forEach(([k, v], i) => {
    const x = i % 2 ? 300 : 50;
    const y = top + Math.floor(i / 2) * 17;
    doc.font('Helvetica').fontSize(9).fillColor('#666').text(k, x, y).fillColor('#1a1a1a').text(v, x + 75, y, { width: 170 });
  });
  top += 65;
  const section = (title, rows, y0) => {
    let y = y0;
    doc.rect(50, y, 495, 18).fill('#f6f6f7');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a1a').text(title, 56, y + 5);
    y += 24;
    rows.forEach((l) => {
      doc.font('Helvetica').fontSize(10).fillColor('#1a1a1a').text(l.name, 56, y, { width: 330 });
      doc.text(money(payroll.currency, l.amount), 390, y, { width: 150, align: 'right' });
      y += 17;
    });
    return y + 6;
  };
  const by = (c) => slip.lines.filter((l) => l.category === c).sort((a, b) => a.sequence - b.sequence);
  top = section('Earnings', [...by('BASIC'), ...by('ALLOWANCE')], top);
  top = section('Deductions', by('DEDUCTION'), top);
  doc.rect(50, top, 495, 28).fill(branding.primaryColor);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#ffffff').text('Net pay', 58, top + 8).text(money(payroll.currency, slip.net), 390, top + 8, { width: 148, align: 'right' });
  top += 42;
  top = section('Paid by the employer (not deducted from you)', by('EMPLOYER'), top);
  doc.font('Helvetica').fontSize(8).fillColor('#777').text('This payslip is confidential. Query it with HR within 30 days.', 50, top + 8);
  doc.end();
}));

router.get('/runs/:id/export', manage, h(async (req, res) => {
  const slips = await prisma.payslip.findMany({ where: { runId: intParam(req.params.id) }, include: { user: { select: { name: true, employeeNo: true, profile: { select: { legalName: true } } } } } });
  const rows = slips.map((s) => [s.user.employeeNo, `"${s.user.profile?.legalName || s.user.name}"`, s.gross, s.deductions, s.net].join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="payroll.csv"');
  res.send(`employee_no,name,gross,deductions,net\n${rows.join('\n')}\n`);
}));

module.exports = router;
