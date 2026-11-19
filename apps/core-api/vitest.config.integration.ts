import { defineConfig } from 'vitest/config';

/**
 * Integration tests: a real Postgres (database `core_test`, migrated by the global setup) and a
 * real Redis (db 1). Start them with `docker compose up -d postgres redis`.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.int-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-env.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
