import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// The Prisma CLI does not read the root .env by itself: load it when present (local dev).
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // `prisma generate` needs no database; a placeholder keeps it working without a .env.
    url: process.env.EXTRANET_DATABASE_URL ?? 'postgresql://unset@localhost:5432/extranet',
  },
});
