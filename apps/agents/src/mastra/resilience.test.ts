import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isTransientToolError, resilienceStats, withRetry } from './resilience.js';

const noSleep = { sleep: async () => {} };

describe('withRetry', () => {
  it('retries transient failures until one succeeds, and counts the retries', async () => {
    const before = { ...resilienceStats };
    let calls = 0;
    const result = await withRetry(
      'get_policy',
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('503');
        return 'ok';
      },
      { attempts: 4, baseDelayMs: 1, ...noSleep },
    );
    assert.equal(result, 'ok');
    assert.equal(resilienceStats.retries - before.retries, 2);
    assert.equal(resilienceStats.failures - before.failures, 0);
  });

  it('gives up after the last attempt', async () => {
    const before = resilienceStats.failures;
    await assert.rejects(
      withRetry('read_clause', async () => Promise.reject(new Error('down')), {
        attempts: 2,
        baseDelayMs: 1,
        ...noSleep,
      }),
      /down/,
    );
    assert.equal(resilienceStats.failures - before, 1);
  });
});

describe('isTransientToolError', () => {
  it('recognises transport failures but not business errors', () => {
    assert.ok(isTransientToolError({ error: 'Insurer extranet temporarily unavailable.' }));
    assert.ok(isTransientToolError({ content: [{ text: 'HTTP 429 Rate limit exceeded' }] }));
    assert.ok(!isTransientToolError({ content: [{ text: 'No policy with this number.' }] }));
  });
});
