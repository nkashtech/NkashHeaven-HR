const crypto = require('crypto');

function key() {
  const hex = process.env.MASTER_KEY || '';
  if (hex.length !== 64) throw new Error('MASTER_KEY must be 64 hex characters');
  return Buffer.from(hex, 'hex');
}

// AES-256-GCM, stored as base64 iv.tag.ciphertext
function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

function decrypt(value) {
  if (!value) return null;
  const [iv, tag, data] = value.split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function mask(value, visible = 4) {
  if (!value) return null;
  const s = String(value);
  return `${'•'.repeat(Math.max(s.length - visible, 4))}${s.slice(-visible)}`;
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

// ONB-02: 14 random characters with every class the password rules ask for.
function tempPassword(length = 14) {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%&*?'];
  const all = sets.join('');
  const pick = (s) => s[crypto.randomInt(s.length)];
  const chars = sets.map(pick);
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

module.exports = { encrypt, decrypt, mask, sha256, randomToken, tempPassword };
