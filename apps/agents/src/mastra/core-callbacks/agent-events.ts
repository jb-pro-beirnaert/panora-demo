import type { AgentName } from '@demo/shared';
import { core } from './core-client.js';
import { toolCallEvents } from './tool-events.js';

/**
 * `onStepFinish` of an agent call: reports each tool call to Core as it happens, so the case
 * timeline fills up while the agent works. Never throws.
 */
export function reportToolCalls(caseId: string | null, agent: AgentName) {
  return async (step: unknown): Promise<void> => {
    for (const event of toolCallEvents(agent, step)) await core.agentEvent(caseId, event);
  };
}
