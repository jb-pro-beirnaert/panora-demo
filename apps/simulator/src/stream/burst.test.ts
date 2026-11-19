import type { InboundEmailInput } from '@demo/shared';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Burst } from './burst.js';

const email = (n: number): InboundEmailInput => ({
  messageId: `<demo-42-${n}@simulator.local>`,
  from: 'a@b.fr',
  to: 'c@d.fr',
  subject: `s${n}`,
  body: 'b',
  receivedAt: '2026-11-17T09:00:00.000Z',
  attachments: [],
});

describe('Burst', () => {
  it('plans unique e-mails plus a few duplicates of already-planned ones', () => {
    let draw = 0;
    const burst = new Burst(
      [email(1), email(2)],
      async () => {},
      () => (draw++ % 10 === 0 ? 0 : 0.5),
    );
    const plan = burst.plan(100, 1);
    const unique = plan.filter((item) => !item.duplicate);
    assert.equal(unique.length, 100);
    assert.equal(new Set(unique.map((item) => item.email.messageId)).size, 100);
    const duplicates = plan.filter((item) => item.duplicate);
    assert.ok(duplicates.length > 0);
    const ids = new Set(unique.map((item) => item.email.messageId));
    assert.ok(duplicates.every((item) => ids.has(item.email.messageId)));
  });

  it('sends everything and counts duplicates apart', async () => {
    const delivered: string[] = [];
    const burst = new Burst(
      [email(1)],
      async (e) => void delivered.push(e.messageId),
      () => 0,
    );
    burst.start(20, 4);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(burst.state.sent, 20);
    assert.equal(burst.state.duplicates, delivered.length - 20);
    assert.ok(burst.state.finishedAt);
  });
});
