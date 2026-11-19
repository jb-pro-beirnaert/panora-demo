import { defineConfig } from 'vitest/config';

/** Unit tests: no database, no Redis. */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
  },
});
