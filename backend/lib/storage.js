const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const prisma = require('./prisma');
const { asPlatform } = require('./tenant');

// Cloud storage when AWS_BUCKET is set, local disk otherwise. Files already on disk keep being read from there.
const ROOT = path.join(__dirname, '..', 'uploads');
const bucket = () => (process.env.NODE_ENV === 'test' ? '' : process.env.AWS_BUCKET || '');
// The bucket may be shared with other apps, so everything stays under one folder.
const cloudKey = (storageKey) => `${process.env.STORAGE_PREFIX || 'nkash-hr'}/${path.basename(storageKey)}`;

let client;
function s3() {
  if (!client) {
    client = new S3Client({
      region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
      endpoint: process.env.AWS_ENDPOINT || undefined,
      forcePathStyle: process.env.AWS_USE_PATH_STYLE_ENDPOINT === 'true',
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  return client;
}

async function saveFile({ buffer, name, mime, ownerId, purpose }) {
  const storageKey = crypto.randomBytes(16).toString('hex');
  if (bucket()) {
    await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: cloudKey(storageKey), Body: buffer, ContentType: mime }));
  } else {
    fs.mkdirSync(ROOT, { recursive: true });
    await fs.promises.writeFile(path.join(ROOT, storageKey), buffer);
  }
  return prisma.fileObject.create({ data: { ownerId, name: name.slice(0, 190), mime, size: buffer.length, storageKey, purpose } });
}

// The file's bytes, or null if it's gone.
async function readFile(file) {
  const local = path.join(ROOT, path.basename(file.storageKey));
  if (fs.existsSync(local)) return fs.promises.readFile(local);
  if (!bucket()) return null;
  try {
    const { Body } = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: cloudKey(file.storageKey) }));
    return Buffer.from(await Body.transformToByteArray());
  } catch (err) {
    if (err.name === 'NoSuchKey') return null;
    throw err;
  }
}

async function removeFile(file) {
  await fs.promises.rm(path.join(ROOT, path.basename(file.storageKey)), { force: true });
  if (bucket()) await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: cloudKey(file.storageKey) }));
}

async function storageBytes() {
  return asPlatform(async () => {
    const { _sum } = await prisma.fileObject.aggregate({ _sum: { size: true } });
    return _sum.size || 0;
  });
}

module.exports = { saveFile, readFile, removeFile, storageBytes, isCloud: () => Boolean(bucket()) };
