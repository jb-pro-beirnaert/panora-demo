import type { AgentName, WorkStep } from '@demo/shared';
import { core } from './core-client.js';
import { toolCallEvents } from './tool-events.js';

/**
 * `onStepFinish` of an agent call: reports each tool call to Core as it happens, so the case
 * timeline fills up while the agent works. Never throws.
 */
/**
 * Announces the start of a workflow step (V13), so the inbox shows which agent is running. The
 * execution step is the code step after approval (`system`). Never throws.
 */
export async function reportStepStarted(
  caseId: string | null,
  step: WorkStep,
  extra: Record<string, string> = {},
): Promise<void> {
  const agent: AgentName = step === 'execute' ? 'system' : step;
  await core.agentEvent(caseId, { agent, eventType: 'step_started', params: { step, ...extra } });
}

export function reportToolCalls(caseId: string | null, agent: AgentName) {
  return async (step: unknown): Promise<void> => {
    for (const event of toolCallEvents(agent, step)) await core.agentEvent(caseId, event);
  };
}
