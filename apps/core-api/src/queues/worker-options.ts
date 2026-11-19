import { loadEnv } from '../env.js';

/**
 * Options of the BullMQ workers, read once at startup (decorators are evaluated at import time):
 * concurrency, and a rate limiter aligned with the LLM API quota (V9).
 */
export function workerOptions(): {
  concurrency: number;
  limiter?: { max: number; duration: number };
} {
  let env;
  try {
    env = loadEnv();
  } catch {
    return { concurrency: 10 };
  }
  return {
    concurrency: env.WORKER_CONCURRENCY,
    ...(env.WORKER_RATE_MAX > 0
      ? { limiter: { max: env.WORKER_RATE_MAX, duration: env.WORKER_RATE_DURATION_MS } }
      : {}),
  };
}
