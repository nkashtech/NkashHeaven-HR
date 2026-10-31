const { Prisma } = require('@prisma/client');
const prisma = require('./prisma');
const { runAs } = require('./tenant');
const { STARTER_ROLES } = require('./permissions');
const { ensureCompanyChannels, ensureDepartmentChannel } = require('./chat');
const { toDbDate, today, yearOf } = require('./time');

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const HOLIDAYS = [
  ['01-01', "New Year's Day"], ['03-21', 'Human Rights Day'], ['04-27', 'Freedom Day'], ['05-01', "Workers' Day"], ['06-16', 'Youth Day'],
  ['08-09', "National Women's Day"], ['09-24', 'Heritage Day'], ['12-16', 'Day of Reconciliation'], ['12-25', 'Christmas Day'], ['12-26', 'Day of Goodwill'],
];

const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// Everything a new company needs on day one. Each part stays editable by its admin.
async function setupCompany(companyId, timezone) {
  return runAs(companyId, async () => {
    for (const role of STARTER_ROLES) await prisma.accessRole.create({ data: role });
    await prisma.workSchedule.create({ data: { name: 'Mon–Fri 08:00–17:00', days: Object.fromEntries(WEEKDAYS.map((d) => [d, { start: '08:00', end: '17:00' }])), breakMinutes: 60, hoursPerDay: 8 } });
    const year = yearOf(today(timezone));
    await prisma.publicHoliday.createMany({ data: [year, year + 1].flatMap((y) => HOLIDAYS.map(([md, name]) => ({ date: toDbDate(`${y}-${md}`), name }))) });
    await prisma.leaveType.createMany({
      data: [
        { name: 'Annual leave', colour: '#E2744A', accrualPerMonth: 1.25, maxCarryOver: 5, carryExpiry: '06-30' },
        { name: 'Sick leave', colour: '#3D9A8B', defaultDays: 10, attachmentAfterDays: 2 },
        { name: 'Family responsibility', colour: '#2F62E3', defaultDays: 3 },
        { name: 'Unpaid leave', colour: '#8A8F98', requiresAllocation: false },
      ],
    });
    for (const [sequence, name] of ['Planning', 'In Progress', 'On Hold', 'Done'].entries()) await prisma.projectStage.create({ data: { name, sequence } });
    await ensureCompanyChannels();
    const dept = await prisma.department.create({ data: { name: 'General' } });
    await ensureDepartmentChannel(dept);
  });
}

// Every table a company owns rows in. These have foreign keys between them, some circular, so the checks are off while the rows go.
const COMPANY_TABLES = Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === 'companyId')).map((m) => m.name);

// All or nothing. Returns the company's stored files, which the caller removes once this has gone through.
async function deleteCompany(id) {
  const files = await prisma.fileObject.findMany({ where: { companyId: id }, select: { storageKey: true } });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
    try {
      // These tables have no companyId of their own.
      await tx.$executeRaw`DELETE f FROM ProjectFavorite f JOIN Project p ON p.id = f.projectId WHERE p.companyId = ${id}`;
      await tx.$executeRaw`DELETE a FROM TaskAssignee a JOIN Task t ON t.id = a.taskId WHERE t.companyId = ${id}`;
      await tx.$executeRaw`DELETE l FROM PayslipLine l JOIN Payslip p ON p.id = l.payslipId WHERE p.companyId = ${id}`;
      await tx.$executeRaw`DELETE f FROM Follower f JOIN User u ON u.id = f.userId WHERE u.companyId = ${id}`;
      for (const table of COMPANY_TABLES) await tx.$executeRawUnsafe(`DELETE FROM \`${table}\` WHERE companyId = ?`, id);
      await tx.$executeRaw`DELETE FROM Company WHERE id = ${id}`;
    } finally {
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
    }
  }, { timeout: 60000 });
  return files;
}

module.exports = { setupCompany, deleteCompany, slugify };
