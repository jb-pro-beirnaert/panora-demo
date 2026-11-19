import { AgentEventCallbackSchema } from '@demo/shared';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toolCallEvents } from './tool-events.js';

describe('toolCallEvents', () => {
  it('keeps the tool and the arguments worth showing, whatever the chunk shape', () => {
    const events = toolCallEvents('coverage', {
      toolCalls: [
        { payload: { toolName: 'get_policy', args: { number: 'C-48213' } } },
        { toolName: 'read_clause', args: { ref: 'CG-HZ-12.1', extra: { nested: true } } },
      ],
    });
    assert.deepEqual(events, [
      {
        agent: 'coverage',
        eventType: 'tool_call',
        params: { tool: 'get_policy', number: 'C-48213' },
      },
      {
        agent: 'coverage',
        eventType: 'tool_call',
        params: { tool: 'read_clause', ref: 'CG-HZ-12.1' },
      },
    ]);
    for (const event of events) AgentEventCallbackSchema.parse(event);
  });

  it('returns nothing for a step without tool calls', () => {
    assert.deepEqual(toolCallEvents('drafting', { text: 'done' }), []);
    assert.deepEqual(toolCallEvents('drafting', undefined), []);
  });
});
