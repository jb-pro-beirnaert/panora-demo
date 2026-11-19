import type { AgentEventCallback, AgentName } from '@demo/shared';

/** Arguments worth showing in the live timeline, per tool (never the whole payload). */
const SHOWN_ARGS = ['policyNumber', 'number', 'holderName', 'ref', 'email'] as const;

interface ToolCallLike {
  toolName?: string;
  args?: Record<string, unknown>;
  input?: Record<string, unknown>;
  payload?: { toolName?: string; args?: Record<string, unknown> };
}

/** Normalizes the tool calls of one agent loop step into timeline events. */
export function toolCallEvents(agent: AgentName, step: unknown): AgentEventCallback[] {
  const calls = ((step as { toolCalls?: ToolCallLike[] } | undefined)?.toolCalls ?? []).map(
    (call) => ({
      tool: call.payload?.toolName ?? call.toolName,
      args: call.payload?.args ?? call.args ?? call.input ?? {},
    }),
  );
  return calls.flatMap(({ tool, args }) => {
    if (!tool) return [];
    const params: Record<string, string> = { tool };
    for (const key of SHOWN_ARGS) {
      const value = args[key];
      if (typeof value === 'string' || typeof value === 'number') params[key] = String(value);
    }
    return [{ agent, eventType: 'tool_call', params }];
  });
}
