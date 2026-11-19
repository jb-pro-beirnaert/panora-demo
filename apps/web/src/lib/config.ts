/** Public URLs of the services the browser talks to (inlined at build time). */
export const CORE_API_URL = process.env.NEXT_PUBLIC_CORE_API_URL ?? 'http://localhost:3001';
export const SIMULATOR_URL = process.env.NEXT_PUBLIC_SIMULATOR_URL ?? 'http://localhost:3003';

/** Mastra Studio (the agents server's own UI), for the "View the run" links (V13). */
export const MASTRA_STUDIO_URL =
  process.env.NEXT_PUBLIC_MASTRA_STUDIO_URL ?? 'http://localhost:4111';

export function studioRunUrl(workflowRunId: string): string | null {
  if (!MASTRA_STUDIO_URL) return null;
  return `${MASTRA_STUDIO_URL}/workflows/processEmailWorkflow/graph/${workflowRunId}`;
}

/**
 * Langfuse UI (self-hosted by default, or Cloud), for the "View the trace" links. Empty: tracing
 * is off (`npm run dev:lite`) and the links are hidden.
 */
export const LANGFUSE_URL = process.env.NEXT_PUBLIC_LANGFUSE_URL ?? '';
const LANGFUSE_PROJECT_ID = process.env.NEXT_PUBLIC_LANGFUSE_PROJECT_ID;

/** Link to a case's trace, or null when no Langfuse UI is configured. */
export function traceUrl(traceId: string): string | null {
  if (!LANGFUSE_URL) return null;
  return LANGFUSE_PROJECT_ID
    ? `${LANGFUSE_URL}/project/${LANGFUSE_PROJECT_ID}/traces/${traceId}`
    : `${LANGFUSE_URL}/trace/${traceId}`;
}
