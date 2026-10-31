const { PrismaClient, Prisma } = require('@prisma/client');
const { context } = require('./tenant');

// Every query on a company's data is scoped here, so a route can't forget the filter.
// Outside a company context a query throws instead of reading across companies.
const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
const TENANT = new Set(Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === 'companyId') && m.name !== 'Integration').map((m) => m.name));

function injectData(model, data, companyId) {
  if (Array.isArray(data)) return data.map((d) => injectData(model, d, companyId));
  if (!data || typeof data !== 'object') return data;
  const out = { ...data };
  if (TENANT.has(model) && out.companyId === undefined) out.companyId = companyId;
  for (const field of models.get(model).fields) {
    const nested = out[field.name];
    if (field.kind !== 'object' || !nested || typeof nested !== 'object') continue;
    const next = { ...nested };
    if (next.create) next.create = injectData(field.type, next.create, companyId);
    if (next.createMany?.data) next.createMany = { ...next.createMany, data: injectData(field.type, next.createMany.data, companyId) };
    out[field.name] = next;
  }
  return out;
}

const base = global.__prismaBase || new PrismaClient();
const prisma = global.__prisma || base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!TENANT.has(model)) return query(args);
        const ctx = context();
        if (ctx?.bypass) return query(args);
        const companyId = ctx?.companyId;
        if (companyId === undefined || companyId === null) throw new Error(`${model}.${operation} ran with no company context`);
        const a = { ...args };
        if (['create'].includes(operation)) a.data = injectData(model, a.data, companyId);
        else if (operation === 'createMany') a.data = injectData(model, a.data, companyId);
        else if (operation === 'upsert') {
          a.where = { ...a.where, companyId };
          a.create = injectData(model, a.create, companyId);
          a.update = injectData(model, a.update, companyId);
        } else {
          a.where = { ...a.where, companyId };
          if (a.data) { const { companyId: ignored, ...rest } = injectData(model, a.data, companyId); a.data = rest; }
        }
        return query(a);
      },
    },
  },
});

if (process.env.NODE_ENV !== 'production') {
  global.__prismaBase = base;
  global.__prisma = prisma;
}

module.exports = prisma;
