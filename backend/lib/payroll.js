const prisma = require('./prisma');
const { getSettings } = require('./settings');
const { scheduleOf, shiftOn, holidaysBetween } = require('./attendance');
const { eachDay, fromDbDate, round2, toDbDate } = require('./time');

// Annual PAYE from the configurable tax table, after age rebates (SARS method).
function annualTax(taxable, cfg, age) {
  let band = cfg.brackets[0];
  let lower = 0;
  for (const b of cfg.brackets) {
    band = b;
    if (b.upTo === null || taxable <= b.upTo) break;
    lower = b.upTo;
  }
  const before = band.base + Math.max(0, taxable - lower) * (band.rate / 100);
  let rebate = cfg.rebatePrimary;
  if (age >= 65) rebate += cfg.rebateSecondary;
  if (age >= 75) rebate += cfg.rebateTertiary;
  return Math.max(0, before - rebate);
}

function ageAt(birthDate, dateStr) {
  if (!birthDate) return 0;
  const b = fromDbDate(birthDate);
  const years = Number(dateStr.slice(0, 4)) - Number(b.slice(0, 4));
  return dateStr.slice(5) < b.slice(5) ? years - 1 : years;
}

// Working days in the period, how many fall inside the contract, and how many were unpaid leave.
async function workedDays(user, contract, from, to) {
  const schedule = scheduleOf(user);
  const holidays = await holidaysBetween(from, to);
  const scheduled = eachDay(from, to).filter((d) => shiftOn(schedule, d) && !holidays.has(d));
  const start = fromDbDate(contract.startDate);
  const end = contract.endDate ? fromDbDate(contract.endDate) : '9999-12-31';
  const inContract = scheduled.filter((d) => d >= start && d <= end);
  const unpaid = await prisma.leaveRequest.findMany({
    where: { userId: user.id, state: 'APPROVED', leaveType: { requiresAllocation: false }, dateFrom: { lte: toDbDate(to) }, dateTo: { gte: toDbDate(from) } },
  });
  let unpaidDays = 0;
  for (const r of unpaid) {
    const hit = eachDay(fromDbDate(r.dateFrom), fromDbDate(r.dateTo)).filter((d) => inContract.includes(d)).length;
    unpaidDays += r.halfDay ? Math.min(hit, 0.5) : hit;
  }
  return { scheduled: scheduled.length, inContract: inContract.length, unpaidDays };
}

// Rebuilds a payslip from the contract and rules. Lines added by hand are kept.
async function computePayslip(payslipId) {
  const slip = await prisma.payslip.findUnique({
    where: { id: payslipId }, include: { contract: true, user: { include: { schedule: true, profile: true } }, lines: { where: { manual: true } } },
  });
  const { payroll: cfg } = await getSettings();
  const rules = await prisma.salaryRule.findMany({ where: { active: true }, orderBy: { sequence: 'asc' } });
  const from = fromDbDate(slip.periodStart);
  const to = fromDbDate(slip.periodEnd);
  const days = await workedDays(slip.user, slip.contract, from, to);
  const daily = days.scheduled ? slip.contract.wage / days.scheduled : 0;
  const basic = round2(daily * days.inContract);
  const unpaidAmount = round2(daily * days.unpaidDays);

  const lines = [{ code: 'BASIC', name: 'Basic salary', category: 'BASIC', amount: basic, sequence: 1 }];
  const value = (r) => round2(r.amountType === 'PERCENT_BASIC' ? basic * (r.amount / 100) : r.amount);
  rules.filter((r) => r.category === 'ALLOWANCE').forEach((r) => lines.push({ code: r.code, name: r.name, category: 'ALLOWANCE', amount: value(r), sequence: 10 + r.sequence }));
  const manualAllowances = slip.lines.filter((l) => l.category === 'ALLOWANCE');
  const gross = round2(lines.reduce((s, l) => s + l.amount, 0) + manualAllowances.reduce((s, l) => s + l.amount, 0) - unpaidAmount);

  if (unpaidAmount) lines.push({ code: 'UNPAID', name: `Unpaid leave (${days.unpaidDays} days)`, category: 'DEDUCTION', amount: unpaidAmount, sequence: 100 });
  const uifBase = Math.min(gross, cfg.uifCeiling);
  const uif = round2(uifBase * (cfg.uifRate / 100));
  const paye = round2(annualTax(gross * 12, cfg, ageAt(slip.user.profile?.birthDate, to)) / 12);
  lines.push({ code: 'PAYE', name: 'PAYE (income tax)', category: 'DEDUCTION', amount: paye, sequence: 110 });
  lines.push({ code: 'UIF', name: 'UIF (employee)', category: 'DEDUCTION', amount: uif, sequence: 120 });
  rules.filter((r) => r.category === 'DEDUCTION').forEach((r) => lines.push({ code: r.code, name: r.name, category: 'DEDUCTION', amount: value(r), sequence: 130 + r.sequence }));

  const manualDeductions = slip.lines.filter((l) => l.category === 'DEDUCTION');
  const deductions = round2([...lines.filter((l) => l.category === 'DEDUCTION' && l.code !== 'UNPAID'), ...manualDeductions].reduce((s, l) => s + l.amount, 0));
  const net = round2(gross - deductions);
  lines.push({ code: 'NET', name: 'Net salary', category: 'NET', amount: net, sequence: 200 });
  lines.push({ code: 'UIF_ER', name: 'UIF (employer)', category: 'EMPLOYER', amount: uif, sequence: 210 });
  lines.push({ code: 'SDL', name: 'Skills Development Levy', category: 'EMPLOYER', amount: round2(gross * (cfg.sdlRate / 100)), sequence: 220 });
  rules.filter((r) => r.category === 'EMPLOYER').forEach((r) => lines.push({ code: r.code, name: r.name, category: 'EMPLOYER', amount: value(r), sequence: 230 + r.sequence }));

  await prisma.$transaction([
    prisma.payslipLine.deleteMany({ where: { payslipId, manual: false } }),
    prisma.payslipLine.createMany({ data: lines.map((l) => ({ ...l, payslipId })) }),
    prisma.payslip.update({ where: { id: payslipId }, data: { workedDays: days.inContract - days.unpaidDays, unpaidDays: days.unpaidDays, gross, deductions, net } }),
  ]);
}

// Everyone with a running contract during the period gets a draft payslip.
async function generateRun(run) {
  const contracts = await prisma.contract.findMany({
    where: { state: 'RUNNING', startDate: { lte: run.periodEnd }, OR: [{ endDate: null }, { endDate: { gte: run.periodStart } }], user: { active: true } },
  });
  let created = 0;
  for (const c of contracts) {
    const exists = await prisma.payslip.findUnique({ where: { runId_userId: { runId: run.id, userId: c.userId } } });
    if (exists) continue;
    const number = `SLIP/${fromDbDate(run.periodStart).slice(0, 7)}/${String(c.userId).padStart(4, '0')}`;
    const slip = await prisma.payslip.create({ data: { runId: run.id, userId: c.userId, contractId: c.id, number, periodStart: run.periodStart, periodEnd: run.periodEnd } });
    await computePayslip(slip.id);
    created += 1;
  }
  return created;
}

module.exports = { annualTax, ageAt, computePayslip, generateRun };
