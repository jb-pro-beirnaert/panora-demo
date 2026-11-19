import type { RequestHandler } from 'express';

/**
 * "Flaky extranet" mode (V9): makes the simulated insurer behave like a real one under load —
 * random latency, random errors and a rate limit — to prove the platform's retries and timeouts.
 * Off unless configured. Only `tools/call` requests are affected (listing tools always works).
 */
export interface ChaosConfig {
  latencyMinMs: number;
  latencyMaxMs: number;
  /** Share of tool calls answered with HTTP 503 (0–1). */
  errorRate: number;
  /** Tool calls per second accepted; beyond it, HTTP 429. 0 = no limit. */
  rateLimitPerSecond: number;
}

export function chaosEnabled(config: ChaosConfig): boolean {
  return config.latencyMaxMs > 0 || config.errorRate > 0 || config.rateLimitPerSecond > 0;
}

function isToolCall(body: unknown): boolean {
  const messages = Array.isArray(body) ? body : [body];
  return messages.some(
    (message) => (message as { method?: string } | null)?.method === 'tools/call',
  );
}

export interface ChaosStats {
  calls: number;
  injectedErrors: number;
  rateLimited: number;
}

export function chaosMiddleware(
  config: ChaosConfig,
  random: () => number = Math.random,
  now: () => number = Date.now,
): { middleware: RequestHandler; stats: ChaosStats } {
  const stats: ChaosStats = { calls: 0, injectedErrors: 0, rateLimited: 0 };
  let windowStart = 0;
  let windowCount = 0;
  const middleware: RequestHandler = (req, res, next) => {
    if (!isToolCall(req.body)) {
      next();
      return;
    }
    stats.calls += 1;
    const second = Math.floor(now() / 1_000);
    if (second !== windowStart) {
      windowStart = second;
      windowCount = 0;
    }
    windowCount += 1;
    if (config.rateLimitPerSecond > 0 && windowCount > config.rateLimitPerSecond) {
      stats.rateLimited += 1;
      res
        .status(429)
        .set('Retry-After', '1')
        .json({
          jsonrpc: '2.0',
          error: { code: -32029, message: 'Rate limit exceeded: retry in a second.' },
          id: null,
        });
      return;
    }
    const delay =
      config.latencyMinMs + random() * Math.max(0, config.latencyMaxMs - config.latencyMinMs);
    setTimeout(() => {
      if (random() < config.errorRate) {
        stats.injectedErrors += 1;
        res.status(503).json({
          jsonrpc: '2.0',
          error: { code: -32050, message: 'Insurer extranet temporarily unavailable.' },
          id: null,
        });
        return;
      }
      next();
    }, delay);
  };
  return { middleware, stats };
}
