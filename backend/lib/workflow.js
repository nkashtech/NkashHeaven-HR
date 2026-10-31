const prisma = require('./prisma');
const { managerOf, adminIds } = require('./access');
const { getSettings } = require('./settings');

// A company either has the manager approve before HR, or sends requests straight to HR.
const LEGACY = {
  NONE: [], MANAGER: [{ kind: 'MANAGER' }], HR: [{ kind: 'HR' }], MANAGER_HR: [{ kind: 'MANAGER' }, { kind: 'HR' }],
};

async function leaveSteps(type) {
  if (type.workflowId) {
    const wf = await prisma.workflow.findUnique({ where: { id: type.workflowId } });
    if (wf?.active) return wf.steps;
  }
  return LEGACY[type.approvalSteps];
}

async function timesheetSteps() {
  const { timesheets } = await getSettings();
  if (timesheets.workflowId) {
    const wf = await prisma.workflow.findUnique({ where: { id: timesheets.workflowId } });
    if (wf?.active) return wf.steps;
  }
  return LEGACY.MANAGER;
}

// Who can act on a step for this employee. An empty result falls back to the company's admins.
async function approversFor(step, employee) {
  let ids = [];
  if (step.kind === 'MANAGER') ids = [await managerOf(employee)];
  if (step.kind === 'HR') ids = await adminIds();
  if (step.kind === 'USER') ids = [Number(step.userId)];
  if (step.kind === 'ROLE') ids = (await prisma.user.findMany({ where: { active: true, accessRoleId: Number(step.roleId) }, select: { id: true } })).map((u) => u.id);
  const people = ids.filter((id) => id && id !== employee.id);
  return people.length ? people : (await adminIds()).filter((id) => id !== employee.id);
}

// The step after `index`, skipping any the same approver would just approve again.
async function nextIndex(steps, index, employee, actorId) {
  let i = index + 1;
  while (i < steps.length) {
    const ids = await approversFor(steps[i], employee);
    if (!(ids.length === 1 && ids[0] === actorId)) break;
    i += 1;
  }
  return i;
}

// Short names for the steps, so people can see where a request is.
async function stepLabel(step) {
  if (!step) return null;
  if (step.kind === 'MANAGER') return 'Manager';
  if (step.kind === 'HR') return 'HR';
  if (step.kind === 'USER') return (await prisma.user.findUnique({ where: { id: Number(step.userId) }, select: { name: true } }))?.name || 'Approver';
  return (await prisma.accessRole.findUnique({ where: { id: Number(step.roleId) }, select: { name: true } }))?.name || 'Approver';
}

module.exports = { stepLabel, leaveSteps, timesheetSteps, approversFor, nextIndex };
