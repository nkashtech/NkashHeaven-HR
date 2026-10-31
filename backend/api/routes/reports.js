const express = require('express');
const ExcelJS = require('exceljs');
const prisma = require('../../lib/prisma');
const { authenticate, requirePerm } = require('../middleware/auth');
const { HttpError, h, dateParam } = require('../middleware/validation');
const { getSettings } = require('../../lib/settings');
const { visibleUserFilter } = require('../../lib/access');
const { toDbDate, fromDbDate, today, addDays, round2 } = require('../../lib/time');

const router = express.Router();
router.use(authenticate);

async function people(req) {
  const filter = await visibleUserFilter(req.user);
  return { ...filter, departmentId: req.query.departmentId ? Number(req.query.departmentId) : undefined };
}

const BUILDERS = {
  async attendance(req, from, to) {
    const rows = await prisma.attendance.findMany({
      where: { user: await people(req), deletedAt: null, date: { gte: toDbDate(from), lte: toDbDate(to) } },
      include: { user: { select: { id: true, name: true, employeeNo: true, department: { select: { name: true } } } } },
    });
    const by = new Map();
    for (const r of rows) {
      const cur = by.get(r.userId) || { name: r.user.name, employeeNo: r.user.employeeNo, department: r.user.department?.name || '', days: new Set(), worked: 0, extra: 0, late: 0, auto: 0, edited: 0 };
      cur.days.add(fromDbDate(r.date));
      cur.worked += r.workedHours || 0;
      cur.extra += r.extraHours || 0;
      cur.late += r.lateMinutes ? 1 : 0;
      cur.auto += r.autoClosed ? 1 : 0;
      cur.edited += r.isEdited ? 1 : 0;
      by.set(r.userId, cur);
    }
    return {
      title: 'Attendance summary',
      columns: [['employeeNo', 'Employee no.'], ['name', 'Employee'], ['department', 'Department'], ['daysPresent', 'Days present'], ['worked', 'Worked hours'], ['extra', 'Extra hours'], ['late', 'Late days'], ['auto', 'Auto check-outs'], ['edited', 'Edited records']],
      rows: [...by.values()].map((c) => ({ ...c, daysPresent: c.days.size, worked: round2(c.worked), extra: round2(c.extra), days: undefined })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  },
  async timesheets(req, from, to) {
    const rows = await prisma.timesheetLine.findMany({
      where: { user: await people(req), hours: { gt: 0 }, date: { gte: toDbDate(from), lte: toDbDate(to) } },
      include: { project: { select: { name: true } }, task: { select: { name: true } }, user: { select: { name: true } } },
    });
    const by = new Map();
    for (const r of rows) {
      const key = `${r.projectId}:${r.taskId}:${r.userId}`;
      const cur = by.get(key) || { project: r.project.name, task: r.task?.name || '', employee: r.user.name, hours: 0, validated: 0 };
      cur.hours = round2(cur.hours + r.hours);
      if (r.state === 'VALIDATED') cur.validated = round2(cur.validated + r.hours);
      by.set(key, cur);
    }
    return {
      title: 'Timesheets by project',
      columns: [['project', 'Project'], ['task', 'Task'], ['employee', 'Employee'], ['hours', 'Hours'], ['validated', 'Validated hours']],
      rows: [...by.values()].sort((a, b) => a.project.localeCompare(b.project) || a.task.localeCompare(b.task)),
    };
  },
  async leave(req, from, to) {
    const rows = await prisma.leaveRequest.findMany({
      where: { user: await people(req), state: { in: ['APPROVED'] }, dateFrom: { lte: toDbDate(to) }, dateTo: { gte: toDbDate(from) } },
      include: { leaveType: { select: { name: true } }, user: { select: { name: true, department: { select: { name: true } } } } }, orderBy: { dateFrom: 'asc' },
    });
    return {
      title: 'Leave taken',
      columns: [['employee', 'Employee'], ['department', 'Department'], ['type', 'Leave type'], ['from', 'From'], ['to', 'To'], ['days', 'Days']],
      rows: rows.map((r) => ({ employee: r.user.name, department: r.user.department?.name || '', type: r.leaveType.name, from: fromDbDate(r.dateFrom), to: fromDbDate(r.dateTo), days: r.days })),
    };
  },
  // TS-08 / US-M03
  async comparison(req, from, to) {
    const where = { user: await people(req), date: { gte: toDbDate(from), lte: toDbDate(to) } };
    const [att, lines] = await Promise.all([
      prisma.attendance.findMany({ where: { ...where, deletedAt: null }, include: { user: { select: { name: true } } } }),
      prisma.timesheetLine.findMany({ where, include: { user: { select: { name: true } } } }),
    ]);
    const by = new Map();
    const row = (userId, name, date) => {
      const key = `${userId}:${date}`;
      if (!by.has(key)) by.set(key, { employee: name, date, attended: 0, logged: 0 });
      return by.get(key);
    };
    att.forEach((a) => { row(a.userId, a.user.name, fromDbDate(a.date)).attended += a.workedHours || 0; });
    lines.forEach((l) => { row(l.userId, l.user.name, fromDbDate(l.date)).logged += l.hours; });
    return {
      title: 'Attendance vs timesheets',
      columns: [['employee', 'Employee'], ['date', 'Date'], ['attended', 'Attended'], ['logged', 'Logged'], ['gap', 'Gap']],
      rows: [...by.values()].map((r) => ({ ...r, attended: round2(r.attended), logged: round2(r.logged), gap: round2(r.attended - r.logged) })).sort((a, b) => b.date.localeCompare(a.date) || a.employee.localeCompare(b.employee)),
    };
  },
};

const csvCell = (v) => {
  // A leading =, +, - or @ would run as a formula when the file opens in Excel.
  const s = String(v ?? '').replace(/^([=+\-@])/, "'$1");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

router.get('/:kind', requirePerm('reports.view'), h(async (req, res) => {
  const builder = BUILDERS[req.params.kind];
  if (!builder) throw new HttpError(404, 'Unknown report');
  const { timezone: tz } = await getSettings();
  const to = req.query.to ? dateParam(req.query.to, 'to') : today(tz);
  const from = req.query.from ? dateParam(req.query.from, 'from') : addDays(to, -29);
  const report = await builder(req, from, to);
  const file = `${req.params.kind}-${from}-to-${to}`;
  if (req.query.format === 'csv') {
    const lines = [report.columns.map(([, label]) => csvCell(label)).join(','), ...report.rows.map((r) => report.columns.map(([k]) => csvCell(r[k])).join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file}.csv"`);
    return res.send(`﻿${lines.join('\n')}`);
  }
  if (req.query.format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet(report.title.slice(0, 31));
    sheet.columns = report.columns.map(([key, header]) => ({ key, header, width: Math.max(14, header.length + 4) }));
    sheet.getRow(1).font = { bold: true };
    report.rows.forEach((r) => sheet.addRow(r));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${file}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  }
  return res.json({ ...report, columns: report.columns.map(([key, label]) => ({ key, label })), from, to });
}));

module.exports = router;
