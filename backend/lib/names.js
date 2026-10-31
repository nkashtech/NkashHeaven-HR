// A name typed as one line: the first word is the first name, the rest is the surname.
function splitName(name) {
  const [firstName, ...rest] = String(name || '').trim().split(/\s+/);
  return { firstName: firstName || null, lastName: rest.join(' ') || null };
}

const fullName = ({ firstName, middleName, lastName }) => [firstName, middleName, lastName].filter(Boolean).join(' ');

module.exports = { splitName, fullName };
