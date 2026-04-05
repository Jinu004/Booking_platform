require('dotenv').config();

const requiredVariables = [
  'PORT',
  'NODE_ENV',
  'DATABASE_URL',
  'REDIS_URL',
  'CLERK_SECRET_KEY',
  'CLAUDE_API_KEY'
];

for (const key of requiredVariables) {
  if (!process.env[key]) {
    throw new Error(`Environment variable ${key} is missing in .env file`);
  }
}

const env = {
  PORT: parseInt(process.env.PORT || '3001', 10),
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY,
  META_WHATSAPP_TOKEN: process.env.META_WHATSAPP_TOKEN,
  META_WEBHOOK_VERIFY_TOKEN: process.env.META_WEBHOOK_VERIFY_TOKEN,
  META_PHONE_NUMBER_ID: process.env.META_PHONE_NUMBER_ID,
  CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
  WAHA_BASE_URL: process.env.WAHA_BASE_URL,
  WAHA_API_KEY: process.env.WAHA_API_KEY
};

module.exports = env;
