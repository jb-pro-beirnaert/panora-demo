import {
  TEST_ADMIN_TOKEN,
  TEST_INBOUND_TOKEN,
  TEST_MASTRA_API_TOKEN,
  TEST_DATABASE_URL,
  TEST_REDIS_URL,
  TEST_SERVICE_TOKEN,
} from './test-env.js';

// Set before the app reads its environment (the root .env never overrides these).
process.env.CORE_DATABASE_URL = TEST_DATABASE_URL;
process.env.REDIS_URL = TEST_REDIS_URL;
process.env.CORE_SERVICE_TOKEN = TEST_SERVICE_TOKEN;
process.env.ADMIN_TOKEN = TEST_ADMIN_TOKEN;
process.env.DEMO_MODE = 'true';
process.env.INBOUND_EMAIL_TOKEN = TEST_INBOUND_TOKEN;
process.env.MASTRA_API_TOKEN = TEST_MASTRA_API_TOKEN;
