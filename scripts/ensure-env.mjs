// First run on a fresh clone: creates the root .env from .env.example, with a random value for
// every `change-me-…` secret. Never touches an existing .env.
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const target = new URL('.env', root);
if (existsSync(target)) process.exit(0);

copyFileSync(new URL('.env.example', root), target);
const secret = () => randomBytes(24).toString('base64url');
const filled = readFileSync(target, 'utf8').replace(/=change-me-[^\n]*/g, () => `=${secret()}`);
writeFileSync(target, filled);
console.log(
  'Created .env from .env.example with random secrets. Set OPENAI_API_KEY in it (or AGENTS_MODE=simulated to run without an LLM).',
);
