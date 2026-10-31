require('dotenv').config();

// Fail at start-up, not on the first sign-in or the first bank detail.
const missing = ['DATABASE_URL', 'JWT_SECRET', 'MASTER_KEY', 'CLIENT_URL'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
if (process.env.MASTER_KEY.length !== 64 || (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET.length < 32)) {
  console.error('MASTER_KEY must be 64 hex characters and JWT_SECRET at least 32 characters');
  process.exit(1);
}

const http = require('http');
const app = require('./index');
const { initRealtime } = require('../lib/realtime');
const { startJobs } = require('../lib/jobs');

const PORT = process.env.PORT || 3011;

const server = http.createServer(app);
initRealtime(server, app.locals.allowedOrigins);

server.listen(PORT, () => {
  console.log(`NkashHeaven-HR API listening on port ${PORT}`);
  if (process.env.RUN_JOBS !== 'false') startJobs();
});
