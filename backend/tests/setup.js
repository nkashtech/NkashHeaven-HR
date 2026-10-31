const { execSync } = require('child_process');
const path = require('path');

module.exports = async () => {
  require('./env');
  execSync('npx prisma db push --force-reset --skip-generate --accept-data-loss', {
    cwd: path.join(__dirname, '..'), env: process.env, stdio: 'ignore',
  });
};
