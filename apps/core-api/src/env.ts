import { existsSync } from 'node:fs';
import { z } from 'zod';

// Local dev: the single root .env (never overrides variables already set, e.g. in Docker).
const rootEnv = new URL('../../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const EnvSchema = z
  .object({
    CORE_API_PORT: z.coerce.number().int().positive().default(3001),
    CORE_DATABASE_URL: z
      .string()
      .min(1)
      .default('postgresql://postgres:postgres@localhost:5432/core'),
    REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
    /**
     * Base URL(s) of the Mastra server(s), comma-separated (V9: several instances, round robin
     * with failover; they share the `agents` database, so any instance can resume any run).
     */
    MASTRA_URL: z
      .string()
      .default('http://localhost:4111')
      .transform((value) =>
        value
          .split(',')
          .map((url) => url.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.url()).min(1)),
    /** BullMQ workers (V9): jobs in parallel, and rate limit aligned with the LLM API quota. */
    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),
    /** Max workflow starts per WORKER_RATE_DURATION_MS (0 = no limit). */
    WORKER_RATE_MAX: z.coerce.number().int().min(0).default(0),
    WORKER_RATE_DURATION_MS: z.coerce.number().int().positive().default(60_000),
    /** A case with no activity for this long while processing is restarted by the watchdog. */
    STUCK_CASE_AFTER_MS: z.coerce.number().int().positive().default(300_000),
    /** Bearer token the Mastra server presents on `/internal/*` callbacks. */
    CORE_SERVICE_TOKEN: z
      .string()
      .min(16, 'CORE_SERVICE_TOKEN (16+ characters) is required (see .env.example)'),
    /** Origin of the web UI allowed by CORS. */
    WEB_ORIGIN: z.string().default('http://localhost:3000'),
    DEMO_MODE: booleanString,
    ADMIN_TOKEN: z.string().optional(),
  })
  .refine((env) => !env.DEMO_MODE || (env.ADMIN_TOKEN?.length ?? 0) >= 16, {
    message: 'ADMIN_TOKEN (16+ characters) is required when DEMO_MODE=true',
    path: ['ADMIN_TOKEN'],
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment for apps/core-api:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** Injection token of the parsed environment. */
export const ENV = Symbol('ENV');
