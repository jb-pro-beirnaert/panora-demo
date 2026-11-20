import type { AgentEventCallback, AgentName } from '@demo/shared';

/** Arguments worth showing in the live timeline, per tool (never the whole payload). */
const SHOWN_ARGS = ['policyNumber', 'number', 'holderName', 'ref', 'email'] as const;
/** V17: the result kept for "what the agent saw" is cut beyond this many characters of JSON. */
export const MAX_RESULT_CHARS = 8_000;

interface ToolCallLike {
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  input?: Record<string, unknown>;
  payload?: { toolCallId?: string; toolName?: string; args?: Record<string, unknown> };
}

interface ToolResultLike {
  toolCallId?: string;
  result?: unknown;
  output?: unknown;
  payload?: { toolCallId?: string; result?: unknown };
}

/**
 * The data a tool returned, as the agent read it: an MCP result's structured content, or the JSON
 * of its text part; a plain tool's object as it is. Cut at `MAX_RESULT_CHARS`.
 */
export function toolResultData(result: unknown): unknown {
  let data = result;
  const mcp = result as {
    structuredContent?: unknown;
    content?: { type?: string; text?: string }[];
  } | null;
  if (mcp && typeof mcp === 'object') {
    if (mcp.structuredContent) data = mcp.structuredContent;
    else if (Array.isArray(mcp.content)) {
      const text = mcp.content.find((part) => typeof part.text === 'string')?.text ?? '';
      try {
        data = JSON.parse(text);
      } catch {
        data = { text };
      }
    }
  }
  const json = JSON.stringify(data ?? null);
  return json.length > MAX_RESULT_CHARS
    ? { truncated: true, preview: json.slice(0, MAX_RESULT_CHARS) }
    : data;
}

/**
 * Normalizes the tool calls of one agent loop step into timeline events, each with the data the
 * tool returned (V17, "what the agent saw").
 */
export function toolCallEvents(agent: AgentName, step: unknown): AgentEventCallback[] {
  const raw = step as { toolCalls?: ToolCallLike[]; toolResults?: ToolResultLike[] } | undefined;
  const results = new Map<string, unknown>();
  for (const item of raw?.toolResults ?? []) {
    const id = item.payload?.toolCallId ?? item.toolCallId;
    if (id) results.set(id, item.payload?.result ?? item.result ?? item.output);
  }
  const calls = (raw?.toolCalls ?? []).map((call) => ({
    id: call.payload?.toolCallId ?? call.toolCallId,
    tool: call.payload?.toolName ?? call.toolName,
    args: call.payload?.args ?? call.args ?? call.input ?? {},
  }));
  return calls.flatMap(({ id, tool, args }) => {
    if (!tool) return [];
    const params: Record<string, string> = { tool };
    for (const key of SHOWN_ARGS) {
      const value = args[key];
      if (typeof value === 'string' || typeof value === 'number') params[key] = String(value);
    }
    const event: AgentEventCallback = { agent, eventType: 'tool_call', params };
    if (id && results.has(id)) event.result = toolResultData(results.get(id));
    return [event];
  });
}
