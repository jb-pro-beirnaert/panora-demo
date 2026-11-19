/** Public URLs of the services the browser talks to (inlined at build time). */
export const CORE_API_URL = process.env.NEXT_PUBLIC_CORE_API_URL ?? 'http://localhost:3001';
export const SIMULATOR_URL = process.env.NEXT_PUBLIC_SIMULATOR_URL ?? 'http://localhost:3003';

/** Langfuse UI (Cloud or self-hosted), for the "View the trace" links. */
export const LANGFUSE_URL = process.env.NEXT_PUBLIC_LANGFUSE_URL ?? 'https://cloud.langfuse.com';
const LANGFUSE_PROJECT_ID = process.env.NEXT_PUBLIC_LANGFUSE_PROJECT_ID;

export function traceUrl(traceId: string): string {
  return LANGFUSE_PROJECT_ID
    ? `${LANGFUSE_URL}/project/${LANGFUSE_PROJECT_ID}/traces/${traceId}`
    : `${LANGFUSE_URL}/trace/${traceId}`;
}
