// A name typed as one line: the first word is the first name, the rest is the surname.
function splitName(name) {
  const [firstName, ...rest] = String(name || '').trim().split(/\s+/);
  return { firstName: firstName || null, lastName: rest.join(' ') || null };
}

const fullName = ({ firstName, middleName, lastName }) => [firstName, middleName, lastName].filter(Boolean).join(' ');

// A display name may only use words from the person's own names or nickname.
function isOwnName({ firstName, middleName, lastName, preferredName }, displayName) {
  if (!displayName) return true;
  const allowed = new Set([firstName, middleName, lastName, preferredName].filter(Boolean).join(' ').toLowerCase().split(/\s+/));
  return displayName.trim().toLowerCase().split(/\s+/).every((word) => allowed.has(word));
}

module.exports = { splitName, fullName, isOwnName };
