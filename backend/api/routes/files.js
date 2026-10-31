const express = require('express');
const multer = require('multer');
const prisma = require('../../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { HttpError, h, intParam } = require('../middleware/validation');
const { saveFile, readFile } = require('../../lib/storage');
const { runAs } = require('../../lib/tenant');
const { can } = require('../../lib/permissions');
const { isAdmin, canAccessUser } = require('../../lib/access');

const router = express.Router();
router.use(authenticate);

const MAX_SIZE = 20 * 1024 * 1024;
const ALLOWED = [
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];
const PURPOSES = ['chat', 'leave', 'photo', 'profile', 'branding', 'contract'];

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_SIZE } });

router.post('/', (req, res, next) => {
  // Multer resumes from stream events, outside the request's company context, so restore it.
  upload.single('file')(req, res, (err) => runAs(req.user.companyId, () => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, 'Files can be up to 20 MB'));
    return err ? next(err) : next();
  }));
}, h(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose a file');
  if (!ALLOWED.includes(req.file.mimetype)) throw new HttpError(415, 'That file type is not allowed. Use PDF, images or Office files.');
  const purpose = PURPOSES.includes(req.body.purpose) ? req.body.purpose : 'chat';
  if (['photo', 'branding'].includes(purpose) && !req.file.mimetype.startsWith('image/')) throw new HttpError(415, 'This must be an image');
  if (purpose === 'branding' && !(await can(req.user, 'branding.manage'))) throw new HttpError(403, 'Only company admins can upload this');
  if (purpose === 'contract' && !(await can(req.user, 'contracts.manage')) && !(await can(req.user, 'users.manage'))) throw new HttpError(403, 'Only HR can upload this');
  const file = await saveFile({ buffer: req.file.buffer, name: req.file.originalname, mime: req.file.mimetype, ownerId: req.user.id, purpose });
  res.status(201).json({ file: { id: file.id, name: file.name, mime: file.mime, size: file.size } });
}));

async function canRead(user, file) {
  if (file.ownerId === user.id || isAdmin(user) || ['photo', 'branding'].includes(file.purpose)) return true;
  if (file.purpose === 'chat') {
    return Boolean(await prisma.message.findFirst({ where: { attachmentId: file.id, conversation: { members: { some: { userId: user.id } } } } }));
  }
  if (file.purpose === 'leave') return canAccessUser(user, file.ownerId);
  if (file.purpose === 'contract') return Boolean(await prisma.contract.findFirst({ where: { documentFileId: file.id, userId: user.id } }));
  return false;
}

router.get('/:id', h(async (req, res) => {
  const file = await prisma.fileObject.findUnique({ where: { id: intParam(req.params.id) } });
  if (!file) throw new HttpError(404, 'File not found');
  if (!(await canRead(req.user, file))) throw new HttpError(403, 'You do not have access to this file');
  const data = await readFile(file);
  if (!data) throw new HttpError(404, 'File not found');
  res.setHeader('Content-Type', file.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${file.mime.startsWith('image/') ? 'inline' : 'attachment'}; filename="${encodeURIComponent(file.name)}"`);
  res.send(data);
}));

module.exports = router;
