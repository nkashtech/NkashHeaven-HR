require('dotenv').config();

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL.replace(/\/[^/]+$/, '/nkash_hr_test');
process.env.JWT_SECRET = 'test-secret';
process.env.MASTER_KEY = 'a'.repeat(64);
process.env.BREVO_API_KEY = '';
