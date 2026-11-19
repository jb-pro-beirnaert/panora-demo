import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chooseDecision, MAX_REJECTIONS, readSse, REJECTION_COMMENTS } from './auto-validator.js';

describe('chooseDecision', () => {
  it('rejects with a comment below the rejection rate', () => {
    const decision = chooseDecision(() => 0.1, 0.2, 1);
    assert.equal(decision.approved, false);
    assert.ok(REJECTION_COMMENTS.includes(decision.comment ?? ''));
  });

  it('approves above the rejection rate', () => {
    assert.deepEqual(
      chooseDecision(() => 0.5, 0.2, 1),
      { approved: true },
    );
  });

  it('always approves after the maximum number of rejections', () => {
    assert.deepEqual(
      chooseDecision(() => 0, 1, MAX_REJECTIONS + 1),
      { approved: true },
    );
  });
});

describe('readSse', () => {
  it('parses events split across chunks', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: case.created\ndata: {"a"'));
        controller.enqueue(encoder.encode(':1}\n\nevent: heartbeat\ndata: {}\n\n'));
        controller.close();
      },
    });
    const messages = [];
    for await (const message of readSse(body)) messages.push(message);
    assert.deepEqual(messages, [
      { event: 'case.created', data: '{"a":1}' },
      { event: 'heartbeat', data: '{}' },
    ]);
  });
});
