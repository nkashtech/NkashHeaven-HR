class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Wraps an async route so a rejected promise reaches the error handler.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function required(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length) throw new HttpError(400, `Missing required field(s): ${missing.join(', ')}`);
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());

function dateParam(value, name = 'date') {
  if (!isDate(value)) throw new HttpError(400, `${name} must be a date as yyyy-mm-dd`);
  return value;
}

function intParam(value, name = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${name}`);
  return n;
}

// ONB-03 rules. Returns the failures so the screen can show them as a checklist.
function passwordProblems(password, { minLength = 12 } = {}) {
  const p = String(password || '');
  const problems = [];
  if (p.length < minLength) problems.push(`At least ${minLength} characters`);
  if (!/[A-Z]/.test(p)) problems.push('An upper-case letter');
  if (!/[a-z]/.test(p)) problems.push('A lower-case letter');
  if (!/[0-9]/.test(p)) problems.push('A number');
  if (!/[^A-Za-z0-9]/.test(p)) problems.push('A symbol');
  return problems;
}

module.exports = { HttpError, h, required, isDate, dateParam, intParam, passwordProblems };
