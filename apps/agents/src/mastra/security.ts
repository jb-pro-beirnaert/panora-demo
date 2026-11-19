import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { env } from './env.js';

const sameToken = (received: string, expected: string) => {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Core → Mastra service token (V10). Every API call must carry `Authorization: Bearer
 * MASTRA_API_TOKEN`, except, outside production, the calls Mastra Studio makes to its own server
 * (same origin), so the Studio keeps working in development.
 */
export const requireServiceToken: MiddlewareHandler = async (c, next) => {
  if (!env.MASTRA_API_TOKEN) return next();
  const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (bearer && sameToken(bearer, env.MASTRA_API_TOKEN)) return next();
  const origin = new URL(c.req.url).origin;
  const fromStudio =
    process.env.NODE_ENV !== 'production' &&
    (c.req.header('referer') ?? c.req.header('origin') ?? '').startsWith(origin);
  if (fromStudio) return next();
  return c.json({ error: 'A valid Bearer token is required.' }, 401);
};
