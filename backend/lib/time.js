const { fromZonedTime, formatInTimeZone } = require('date-fns-tz');

// A "date string" is yyyy-MM-dd. Calendar days travel as strings so a timezone can never shift them.
const DEFAULT_TZ = 'Africa/Johannesburg';
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const localDate = (utc, tz = DEFAULT_TZ) => formatInTimeZone(utc, tz, 'yyyy-MM-dd');
const localTime = (utc, tz = DEFAULT_TZ) => formatInTimeZone(utc, tz, 'HH:mm');
const toDbDate = (s) => new Date(`${s}T00:00:00.000Z`);
const fromDbDate = (d) => d.toISOString().slice(0, 10);
const zonedToUtc = (dateStr, hhmm, tz = DEFAULT_TZ) => fromZonedTime(`${dateStr} ${hhmm}:00`, tz);
const today = (tz = DEFAULT_TZ) => localDate(new Date(), tz);

function addDays(dateStr, n) {
  const d = toDbDate(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return fromDbDate(d);
}

const weekdayIndex = (dateStr) => toDbDate(dateStr).getUTCDay();
const weekdayKey = (dateStr) => WEEKDAYS[weekdayIndex(dateStr)];
const mondayOf = (dateStr) => addDays(dateStr, -((weekdayIndex(dateStr) + 6) % 7));

function eachDay(from, to) {
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

const monthStart = (dateStr) => `${dateStr.slice(0, 7)}-01`;
function monthEnd(dateStr) {
  const d = toDbDate(monthStart(dateStr));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return fromDbDate(d);
}

const yearOf = (dateStr) => Number(dateStr.slice(0, 4));
const round2 = (n) => Math.round(n * 100) / 100;
const hoursBetween = (a, b) => round2((new Date(b) - new Date(a)) / 3600000);

module.exports = {
  DEFAULT_TZ, localDate, localTime, toDbDate, fromDbDate, zonedToUtc, today, addDays, weekdayIndex, weekdayKey,
  mondayOf, eachDay, monthStart, monthEnd, yearOf, round2, hoursBetween,
};
