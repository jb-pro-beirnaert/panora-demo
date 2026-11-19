import type { RunOptions } from '@demo/shared';
import type { ModelRouterModelId } from '@mastra/core/llm';
import type { RequestContext } from '@mastra/core/request-context';
import { env } from './env.js';

export type AgentRole = 'triage' | 'coverage' | 'drafting';

/** Request-context key of the model override of an agent (eval matrix, V8). */
export const modelKey = (role: AgentRole) => `model.${role}`;

const DEFAULTS: Record<AgentRole, () => string> = {
  triage: () => env.TRIAGE_MODEL,
  coverage: () => env.COVERAGE_MODEL,
  drafting: () => env.DRAFTING_MODEL,
};

/** The model spec an agent runs with for this request: the override, else the env default. */
export function modelSpecOf(role: AgentRole, requestContext?: RequestContext): string {
  const override = requestContext?.get(modelKey(role));
  return typeof override === 'string' && override ? override : DEFAULTS[role]();
}

/**
 * Mastra model config of a spec. `ollama/<model>` is a local model served by Ollama through its
 * OpenAI-compatible API (no key, no cost); anything else goes through Mastra's model router.
 */
export function resolveModel(spec: string) {
  if (spec.startsWith('ollama/')) {
    return {
      providerId: 'ollama',
      modelId: spec.slice('ollama/'.length),
      url: `${env.OLLAMA_BASE_URL.replace(/\/$/, '')}/v1`,
      apiKey: 'ollama',
    };
  }
  return spec as ModelRouterModelId;
}

/** `agent.model` as a function: the model is chosen per request. */
export const dynamicModel =
  (role: AgentRole) =>
  ({ requestContext }: { requestContext: RequestContext }) =>
    resolveModel(modelSpecOf(role, requestContext));

export function modelEntries(options: RunOptions | undefined): [string, string][] {
  return Object.entries(options?.models ?? {})
    .filter((entry): entry is [AgentRole, string] => typeof entry[1] === 'string')
    .map(([role, spec]) => [modelKey(role), spec]);
}
