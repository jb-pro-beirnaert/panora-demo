import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chaosMiddleware } from './chaos.js';

function call(middleware: ReturnType<typeof chaosMiddleware>['middleware'], method = 'tools/call') {
  return new Promise<{ status: number; next: boolean }>((resolve) => {
    const res = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      set() {
        return this;
      },
      json() {
        resolve({ status: this.statusCode, next: false });
      },
    };
    middleware({ body: { method } } as never, res as never, () =>
      resolve({ status: 200, next: true }),
    );
  });
}

describe('chaos middleware', () => {
  it('lets tool listing through and injects errors at the configured rate', async () => {
    const draws = [0.01, 0.5];
    const { middleware, stats } = chaosMiddleware(
      { latencyMinMs: 0, latencyMaxMs: 0, errorRate: 0.05, rateLimitPerSecond: 0 },
      () => draws.shift() ?? 0.9,
    );
    assert.deepEqual(await call(middleware, 'tools/list'), { status: 200, next: true });
    // latency draw (0.01), then error draw (0.5 > 0.05): passes.
    assert.deepEqual(await call(middleware), { status: 200, next: true });
    // latency draw 0.9, error draw 0.9: passes.
    assert.deepEqual(await call(middleware), { status: 200, next: true });
    const failing = chaosMiddleware(
      { latencyMinMs: 0, latencyMaxMs: 0, errorRate: 1, rateLimitPerSecond: 0 },
      () => 0,
    );
    assert.deepEqual(await call(failing.middleware), { status: 503, next: false });
    assert.equal(stats.calls, 2);
  });

  it('rate-limits tool calls per second', async () => {
    const { middleware, stats } = chaosMiddleware(
      { latencyMinMs: 0, latencyMaxMs: 0, errorRate: 0, rateLimitPerSecond: 2 },
      () => 0.5,
      () => 1_000,
    );
    const results = [await call(middleware), await call(middleware), await call(middleware)];
    assert.deepEqual(
      results.map((r) => r.status),
      [200, 200, 429],
    );
    assert.equal(stats.rateLimited, 1);
  });
});
