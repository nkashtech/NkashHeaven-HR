const prisma = require('./prisma');
const { toDbDate } = require('./time');

// ClickUp API v2 with a personal token (pk_...). A ClickUp List becomes a project, its statuses become
// task stages, and matching email addresses become assignees. Re-running updates instead of duplicating.
const API = 'https://api.clickup.com/api/v2';

async function get(token, path) {
  const res = await fetch(`${API}${path}`, { headers: { authorization: token } });
  if (res.status === 401) throw new Error('ClickUp rejected that token');
  if (!res.ok) throw new Error(`ClickUp ${res.status}`);
  return res.json();
}

// Every list the token can reach, grouped by workspace and space, for the picker.
async function listHierarchy(token) {
  const { teams } = await get(token, '/team');
  const out = [];
  for (const team of teams) {
    const { spaces } = await get(token, `/team/${team.id}/space?archived=false`);
    for (const space of spaces) {
      const [{ folders }, { lists }] = await Promise.all([
        get(token, `/space/${space.id}/folder?archived=false`), get(token, `/space/${space.id}/list?archived=false`),
      ]);
      const add = (list, folder) => out.push({ id: list.id, name: list.name, workspace: team.name, space: space.name, folder: folder || null, taskCount: list.task_count ?? null });
      lists.forEach((l) => add(l));
      folders.forEach((f) => (f.lists || []).forEach((l) => add(l, f.name)));
    }
  }
  return out;
}

async function allTasks(token, listId) {
  const tasks = [];
  for (let page = 0; ; page += 1) {
    const data = await get(token, `/list/${listId}/task?page=${page}&include_closed=true&subtasks=true`);
    tasks.push(...data.tasks);
    if (data.last_page !== false || !data.tasks.length) break;
  }
  return tasks;
}

const toDate = (ms) => (ms ? toDbDate(new Date(Number(ms)).toISOString().slice(0, 10)) : null);

async function importList(token, list, { stageId, actorId }) {
  const detail = await get(token, `/list/${list.id}`);
  const name = list.folder ? `${list.folder} · ${detail.name}` : detail.name;
  const externalId = `clickup:list:${list.id}`;
  const existing = await prisma.project.findFirst({ where: { externalId } });
  const project = existing ? await prisma.project.update({ where: { id: existing.id }, data: { name } }) : await prisma.project.create({ data: { name, externalId, stageId, managerId: actorId, createdById: actorId, description: detail.content || null } });
  const stages = new Map();
  const statuses = (detail.statuses || []).length ? detail.statuses : [{ status: 'To Do', orderindex: 0 }];
  for (const st of statuses) {
    const label = st.status.replace(/^\w/, (c) => c.toUpperCase());
    const existing = await prisma.taskStage.findFirst({ where: { projectId: project.id, name: label } });
    const row = existing || await prisma.taskStage.create({ data: { projectId: project.id, name: label, sequence: st.orderindex ?? 0, isDone: ['done', 'closed'].includes(st.type) } });
    stages.set(st.status.toLowerCase(), row);
  }
  const tasks = await allTasks(token, list.id);
  const ids = new Map();
  const emails = [...new Set(tasks.flatMap((t) => (t.assignees || []).map((a) => a.email)).filter(Boolean))];
  const users = await prisma.user.findMany({ where: { email: { in: emails.map((e) => e.toLowerCase()) } }, select: { id: true, email: true } });
  const byEmail = new Map(users.map((u) => [u.email, u.id]));
  const unmatched = new Set();
  for (const t of tasks) {
    const data = {
      name: t.name, projectId: project.id, stageId: stages.get(String(t.status?.status).toLowerCase())?.id ?? null, description: t.markdown_description || t.description || null,
      deadline: toDate(t.due_date), priority: ['urgent', 'high'].includes(t.priority?.priority), plannedHours: t.time_estimate ? t.time_estimate / 3600000 : 0, tags: (t.tags || []).map((x) => x.name),
    };
    const found = await prisma.task.findFirst({ where: { externalId: `clickup:${t.id}` } });
    const task = found ? await prisma.task.update({ where: { id: found.id }, data }) : await prisma.task.create({ data: { ...data, externalId: `clickup:${t.id}`, createdById: actorId } });
    ids.set(t.id, task.id);
    await prisma.taskAssignee.deleteMany({ where: { taskId: task.id } });
    for (const a of t.assignees || []) {
      const userId = byEmail.get(String(a.email).toLowerCase());
      if (userId) await prisma.taskAssignee.create({ data: { taskId: task.id, userId } });
      else unmatched.add(a.email || a.username);
    }
  }
  for (const t of tasks) {
    if (t.parent && ids.has(t.parent)) await prisma.task.update({ where: { id: ids.get(t.id) }, data: { parentId: ids.get(t.parent) } });
  }
  return { project: { id: project.id, name }, tasks: tasks.length, unmatched: [...unmatched] };
}

// Handles quoted fields, commas and new lines inside quotes (ClickUp exports contain all three).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

// Fallback for anyone without an API token: ClickUp's CSV export, or any file with a task name column.
async function importCsv({ csv, projectName, stageId, actorId }) {
  const rows = parseCsv(csv.replace(/^﻿/, ''));
  if (rows.length < 2) throw new Error('The file needs a header row and at least one task');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => names.map((n) => header.indexOf(n)).find((i) => i >= 0);
  const nameCol = col('task name', 'name', 'task');
  if (nameCol === undefined) throw new Error('No "Task Name" column found');
  const statusCol = col('status');
  const dueCol = col('due date', 'deadline', 'due date text');
  const descCol = col('task content', 'description');
  const assigneeCol = col('assignees', 'assignee');
  const project = await prisma.project.create({ data: { name: projectName, stageId, managerId: actorId, createdById: actorId } });
  const stages = new Map();
  let sequence = 0;
  const stageFor = async (label) => {
    const key = (label || 'To Do').trim().toLowerCase();
    if (!stages.has(key)) {
      const name = (label || 'To Do').trim().replace(/^\w/, (c) => c.toUpperCase());
      stages.set(key, await prisma.taskStage.create({ data: { projectId: project.id, name, sequence, isDone: ['done', 'complete', 'closed'].includes(key) } }));
      sequence += 1;
    }
    return stages.get(key);
  };
  const users = await prisma.user.findMany({ where: { active: true }, select: { id: true, email: true, name: true } });
  const unmatched = new Set();
  let count = 0;
  for (const r of rows.slice(1)) {
    if (!r[nameCol]?.trim()) continue;
    const stage = await stageFor(statusCol === undefined ? null : r[statusCol]);
    const due = dueCol === undefined ? null : new Date(r[dueCol]);
    const task = await prisma.task.create({
      data: {
        projectId: project.id, stageId: stage.id, name: r[nameCol].trim(), description: descCol === undefined ? null : r[descCol] || null, createdById: actorId,
        deadline: due && !Number.isNaN(due.getTime()) ? toDbDate(due.toISOString().slice(0, 10)) : null,
      },
    });
    const people = assigneeCol === undefined ? [] : r[assigneeCol].replace(/[[\]]/g, '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    for (const who of people) {
      const user = users.find((u) => u.email === who.toLowerCase() || u.name.toLowerCase() === who.toLowerCase());
      if (user) await prisma.taskAssignee.create({ data: { taskId: task.id, userId: user.id } });
      else unmatched.add(who);
    }
    count += 1;
  }
  return { project: { id: project.id, name: projectName }, tasks: count, unmatched: [...unmatched] };
}

module.exports = { listHierarchy, importList, importCsv, parseCsv };
