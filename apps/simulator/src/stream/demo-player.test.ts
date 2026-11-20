import type { RawEmailInput } from '@demo/shared';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DemoPlayer, type ScriptEmail, type Timers } from './demo-player.js';

const item = (n: number): ScriptEmail => ({
  email: {
    messageId: `<demo-42-${n}@simulator.local>`,
    from: 'a@b.fr',
    to: 'c@d.fr',
    subject: `s${n}`,
    body: 'b',
    receivedAt: '2026-11-17T09:00:00.000Z',
    attachments: [],
  },
  scenario: 'covered',
  requestType: 'claim',
  language: 'fr',
});

/** Timers run by hand: `tick()` fires the pending callback. */
function manualTimers(): Timers & { tick: () => void; pending: () => boolean } {
  let callback: (() => void) | null = null;
  return {
    setTimeout: (cb) => {
      callback = cb;
      return 1;
    },
    clearTimeout: () => {
      callback = null;
    },
    tick: () => {
      const run = callback;
      callback = null;
      run?.();
    },
    pending: () => callback !== null,
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('DemoPlayer', () => {
  it('starts at 0/X and sends nothing until asked', () => {
    const player = new DemoPlayer([item(1), item(2)], async () => {}, 20, manualTimers());
    const state = player.state();
    assert.equal(state.status, 'ready');
    assert.equal(state.sent, 0);
    assert.equal(state.total, 2);
    assert.equal(state.next?.subject, 's1');
  });

  it('"send one" sends the script in order and stops at X/X', async () => {
    const sent: string[] = [];
    const player = new DemoPlayer(
      [item(1), item(2)],
      async (email: RawEmailInput) => void sent.push(email.subject),
      20,
      manualTimers(),
    );
    await player.sendNext();
    await player.sendNext();
    assert.equal(await player.sendNext(), null);
    assert.deepEqual(sent, ['s1', 's2']);
    assert.equal(player.state().status, 'finished');
    assert.equal(player.state().next, null);
  });

  it('playing sends one e-mail per tick, then finishes', async () => {
    const timers = manualTimers();
    const sent: string[] = [];
    const player = new DemoPlayer(
      [item(1), item(2)],
      async (email) => void sent.push(email.subject),
      20,
      timers,
    );
    player.play();
    timers.tick();
    await flush();
    assert.deepEqual(sent, ['s1']);
    timers.tick();
    await flush();
    assert.deepEqual(sent, ['s1', 's2']);
    assert.equal(player.state().status, 'finished');
    assert.equal(timers.pending(), false);
  });

  it('a failed delivery keeps the e-mail next in line', async () => {
    let fail = true;
    const player = new DemoPlayer(
      [item(1)],
      async () => {
        if (fail) throw new Error('down');
      },
      20,
      manualTimers(),
    );
    await player.sendNext();
    assert.equal(player.state().sent, 0);
    assert.equal(player.state().errors, 1);
    fail = false;
    await player.sendNext();
    assert.equal(player.state().sent, 1);
  });

  it('reset goes back to 0/X; resumeFrom skips what Core already has', () => {
    const player = new DemoPlayer([item(1), item(2), item(3)], async () => {}, 20, manualTimers());
    player.resumeFrom(2);
    assert.equal(player.state().sent, 2);
    assert.equal(player.state().status, 'paused');
    assert.equal(player.state().script[1]!.sent, true);
    player.reset();
    assert.equal(player.state().sent, 0);
    assert.equal(player.state().status, 'ready');
  });
});
