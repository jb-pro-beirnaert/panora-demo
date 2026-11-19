import type { TracingContext } from '@mastra/core/observability';
import type { RunOptions } from '@demo/shared';
import { RequestContext } from '@mastra/core/request-context';
import { modelEntries } from '../models.js';
import { PROMPT_VERSIONS } from '../prompts/versions.js';
import { BROKER_CODE_KEY, CASE_ID_KEY } from '../mcp/extranet-client.js';

/** Request context of an agent call: the brokerage (MCP token scope) and the Core case. */
export function caseContext(
  brokerCode: string,
  caseId: string | null,
  options?: RunOptions,
): RequestContext {
  const entries: [string, unknown][] = [[BROKER_CODE_KEY, brokerCode], ...modelEntries(options)];
  if (caseId) entries.push([CASE_ID_KEY, caseId]);
  return new RequestContext(entries);
}

/**
 * Adds the agent's model and prompt version (and any extra field) to the current step's span, so
 * every LLM call in Langfuse can be tied to a model and a prompt version. Tracing errors are
 * ignored: they must never break the workflow.
 */
export function annotateSpan(
  tracingContext: TracingContext | undefined,
  agent: keyof typeof PROMPT_VERSIONS,
  model: string,
  extra: Record<string, unknown> = {},
): void {
  try {
    tracingContext?.currentSpan?.update({
      metadata: { agent, model, promptVersion: PROMPT_VERSIONS[agent], ...extra },
    });
  } catch {
    // never let tracing break a step
  }
}
