import type { InboundEmailInput } from '@demo/shared';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EmailStream, withMessageIdSuffix, type Timers } from './email-stream.js';

const email = (n: number): InboundEmailInput => ({
  messageId: `<demo-42-${n}@simulator.local>`,
  from: 'a@b.fr',
  to: 'c@d.fr',
  subject: `s${n}`,
  body: 'b',
  receivedAt: '2026-11-17T09:00:00.000Z',
  attachments: [],
});

/** Manual timers: `tick()` runs the pending callback. */
function manualTimers() {
  let pending: { callback: () => void; ms: number } | null = null;
  const timers: Timers = {
    setTimeout: (callback, ms) => {
      pending = { callback, ms };
      return pending;
    },
    clearTimeout: () => {
      pending = null;
    },
  };
  return {
    timers,
    pendingDelay: () => pending?.ms ?? null,
    tick: async () => {
      const current = pending;
      pending = null;
      current?.callback();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

describe('EmailStream', () => {
  it('sends the first e-mail at once, then paces the next ones', async () => {
    const delivered: string[] = [];
    const clock = manualTimers();
    const stream = new EmailStream(
      [email(1), email(2)],
      async (e) => void delivered.push(e.subject),
      {
        emailsPerMinute: 6,
        random: () => 0.5,
        timers: clock.timers,
      },
    );
    stream.start();
    assert.equal(clock.pendingDelay(), 0);
    await clock.tick();
    assert.deepEqual(delivered, ['s1']);
    // 6 per minute → 10 s on average (random 0.5 → no jitter).
    assert.equal(clock.pendingDelay(), 10_000);
    await clock.tick();
    assert.deepEqual(delivered, ['s1', 's2']);
    assert.equal(stream.state().sent, 2);
  });

  it('pause stops the stream, resume restarts it', async () => {
    const clock = manualTimers();
    const stream = new EmailStream([email(1)], async () => {}, {
      emailsPerMinute: 60,
      timers: clock.timers,
    });
    stream.start();
    stream.pause();
    assert.equal(stream.state().status, 'paused');
    assert.equal(clock.pendingDelay(), null);
    stream.resume();
    assert.equal(stream.state().status, 'running');
    assert.notEqual(clock.pendingDelay(), null);
  });

  it('gives new message ids after a full cycle, and keeps the jitter within ±40 %', () => {
    const stream = new EmailStream([email(1), email(2)], async () => {}, {
      emailsPerMinute: 1,
      random: () => 0.999,
    });
    const ids = [1, 2, 3].map(() => stream.nextEmail().messageId);
    assert.deepEqual(ids, [
      '<demo-42-1@simulator.local>',
      '<demo-42-2@simulator.local>',
      '<demo-42-1.c1@simulator.local>',
    ]);
    assert.ok(stream.nextDelay() <= 84_000 && stream.nextDelay() >= 83_000);
  });

  it('counts delivery errors without stopping', async () => {
    const stream = new EmailStream(
      [email(1)],
      async () => {
        throw new Error('core down');
      },
      { emailsPerMinute: 1 },
    );
    await stream.sendOne();
    assert.equal(stream.state().errors, 1);
    assert.equal(stream.state().sent, 0);
  });

  it('stop resets the counters', async () => {
    const stream = new EmailStream([email(1)], async () => {}, { emailsPerMinute: 1 });
    await stream.sendOne();
    stream.stop();
    assert.deepEqual(stream.state(), {
      status: 'ready',
      emailsPerMinute: 1,
      sent: 0,
      errors: 0,
      poolSize: 1,
    });
  });
});

describe('withMessageIdSuffix', () => {
  it('inserts the suffix before the domain', () => {
    assert.equal(withMessageIdSuffix(email(7), 'm1').messageId, '<demo-42-7.m1@simulator.local>');
  });
});
