const { AsyncLocalStorage } = require('async_hooks');

// Which company the current request or job belongs to. lib/prisma.js scopes every query to it.
const store = new AsyncLocalStorage();
let fallback = null;

const runAs = (companyId, fn) => store.run({ companyId }, fn);
// Crosses company lines on purpose: sign-in lookups, background loops and the Super Admin console.
const asPlatform = (fn) => store.run({ bypass: true }, fn);
const context = () => store.getStore() || (fallback === null ? null : { companyId: fallback });
const currentCompanyId = () => context()?.companyId ?? null;
const isBypass = () => Boolean(context()?.bypass);
// For seed scripts and tests only, which run outside any request.
const setFallbackCompany = (id) => { fallback = id; };

module.exports = { runAs, asPlatform, context, currentCompanyId, isBypass, setFallbackCompany };
