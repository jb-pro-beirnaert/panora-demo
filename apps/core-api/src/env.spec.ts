import { loadEnv } from './env.js';

describe('loadEnv', () => {
  const base = { CORE_SERVICE_TOKEN: 'a-service-token-123' };

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

  it('requires the service token', () => {
    expect(() => loadEnv({})).toThrow(/CORE_SERVICE_TOKEN/);
  });
});
