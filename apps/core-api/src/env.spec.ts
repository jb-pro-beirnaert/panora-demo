import { loadEnv } from './env.js';

describe('loadEnv', () => {
  const base = {
    CORE_SERVICE_TOKEN: 'a-service-token-123',
    INBOUND_EMAIL_TOKEN: 'an-inbound-token-123',
    MASTRA_API_TOKEN: 'a-mastra-api-token-123',
  };

  it('applies local defaults', () => {
    const env = loadEnv({ ...base });
    expect(env.CORE_API_PORT).toBe(3001);
    expect(env.DEMO_MODE).toBe(false);
  });

  it('requires an admin token in demo mode', () => {
    expect(() => loadEnv({ ...base, DEMO_MODE: 'true' })).toThrow(/ADMIN_TOKEN/);
    expect(loadEnv({ ...base, DEMO_MODE: 'true', ADMIN_TOKEN: 'x'.repeat(16) }).DEMO_MODE).toBe(
      true,
    );
  });

  it('requires every service token', () => {
    expect(() => loadEnv({})).toThrow(/CORE_SERVICE_TOKEN/);
    expect(() => loadEnv({})).toThrow(/INBOUND_EMAIL_TOKEN/);
    expect(() => loadEnv({})).toThrow(/MASTRA_API_TOKEN/);
  });

  it('accepts several Mastra instances', () => {
    expect(
      loadEnv({ ...base, MASTRA_URL: 'http://localhost:4111, http://localhost:4112' }).MASTRA_URL,
    ).toEqual(['http://localhost:4111', 'http://localhost:4112']);
  });
});
