import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { TEST_ADMIN_URL, TEST_DATABASE_URL } from './test-env.js';

/** Creates the `core_test` database if needed and applies the migrations. */
export default async function setup(): Promise<void> {
  const name = new URL(TEST_DATABASE_URL).pathname.slice(1);
  const admin = new pg.Client({ connectionString: TEST_ADMIN_URL });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, CORE_DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
}
