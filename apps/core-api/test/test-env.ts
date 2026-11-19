/** Connection settings of the integration tests (override with CORE_TEST_*). */
export const TEST_ADMIN_URL =
  process.env.CORE_TEST_ADMIN_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/postgres';
export const TEST_DATABASE_URL =
  process.env.CORE_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/core_test';
export const TEST_REDIS_URL = process.env.CORE_TEST_REDIS_URL ?? 'redis://localhost:6379/1';

export const TEST_SERVICE_TOKEN = 'test-service-token-0123456789';
export const TEST_ADMIN_TOKEN = 'test-admin-token-0123456789';
export const TEST_INBOUND_TOKEN = 'test-inbound-token-0123456789';
export const TEST_MASTRA_API_TOKEN = 'test-mastra-api-token-0123456789';
export const TEST_BROKER_PASSWORD = 'test-broker-password';
