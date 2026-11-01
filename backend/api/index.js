const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { router: authRoutes } = require('./routes/auth');
const employeeRoutes = require('./routes/employees');
const attendanceRoutes = require('./routes/attendance');
const { router: timesheetRoutes } = require('./routes/timesheets');
const { router: leaveRoutes } = require('./routes/leave');
const profileRoutes = require('./routes/profile');
const peopleRoutes = require('./routes/people');
const notificationRoutes = require('./routes/notifications');
const fileRoutes = require('./routes/files');
const chatRoutes = require('./routes/chat');
const calendarRoutes = require('./routes/calendar');
const dashboardRoutes = require('./routes/dashboard');
const approvalRoutes = require('./routes/approvals');
const reportRoutes = require('./routes/reports');
const { router: settingsRoutes } = require('./routes/settings');
const systemRoutes = require('./routes/system');
const projectRoutes = require('./routes/projects');
const contractRoutes = require('./routes/contracts');
const payrollRoutes = require('./routes/payroll');
const appraisalRoutes = require('./routes/appraisals');
const publicRoutes = require('./routes/public');
const roleRoutes = require('./routes/roles');
const cardRoutes = require('./routes/cards');
const liveRoutes = require('./routes/live');
const pushRoutes = require('./routes/push');
const { HttpError } = require('./middleware/validation');
const { requestMetrics, logError } = require('../lib/monitor');
const { handleBrevoEvent } = require('../lib/email');
const { asPlatform } = require('../lib/tenant');

const app = express();
app.set('trust proxy', 1);

const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3010').split(',');
app.locals.allowedOrigins = allowedOrigins;

// Logos on /api/public are loaded by the app and by mail clients from other origins.
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:'], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      scriptSrc: ["'self'", "'unsafe-inline'"], connectSrc: ["'self'", 'ws:', 'wss:'], frameSrc: ["'self'"], mediaSrc: ["'self'", 'blob:'],
    },
  },
}));
app.use(requestMetrics);
// A whole office shares one address, and open tabs check in for updates every few seconds.
const isHeartbeat = (req) => req.path.startsWith('/api/live') || /^\/api\/chat\/calls\/\d+$/.test(req.path);
app.use(rateLimit({ skip: isHeartbeat, windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === 'test' ? 100000 : 5000, standardHeaders: true, legacyHeaders: false }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS'), false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

app.get('/api/health', (req, res) => res.json({ status: 'OK', timestamp: new Date().toISOString() }));

// Brevo posts delivery events here. The secret in the path is the only credential Brevo can send.
app.post('/api/webhooks/brevo/:secret', async (req, res) => {
  if (!process.env.BREVO_WEBHOOK_SECRET || req.params.secret !== process.env.BREVO_WEBHOOK_SECRET) return res.sendStatus(404);
  await asPlatform(() => handleBrevoEvent(req.body)).catch((err) => console.error(err));
  return res.sendStatus(200);
});

app.use('/api/public', publicRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/timesheets', timesheetRoutes);
app.use('/api/leave', leaveRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/people', peopleRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/live', liveRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/appraisals', appraisalRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/cards', cardRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Route not found' }));

// In production the API also serves the built app, so one service hosts everything.
const dist = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    if (err.status >= 500) logError(req.originalUrl, err.message, err.status);
    return res.status(err.status).json({ error: err.message, ...(err.details || {}) });
  }
  if (err.code === 'P2002') return res.status(409).json({ error: 'That value already exists' });
  if (err.code === 'P2025') return res.status(404).json({ error: 'Record not found' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
  console.error(err);
  logError(`${req.method} ${req.originalUrl.split('?')[0]}`, err.message, 500);
  return res.status(500).json({ error: 'Something went wrong on our side' });
});

module.exports = app;
