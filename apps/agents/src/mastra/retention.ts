import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { env } from './env.js';

export const PurgeRequestSchema = z.object({
  runIds: z.array(z.string().min(1)).max(1_000),
  traceIds: z.array(z.string().regex(/^[0-9a-f]{1,32}$/)).max(1_000),
});

/** The workflow and its nested workflows each keep a snapshot under the run id. */
export const WORKFLOW_NAMES = ['process-email', 'handle-claim', 'draft-and-approve'];

interface WorkflowsStore {
  deleteWorkflowRunById(args: { runId: string; workflowName: string }): Promise<void>;
}

/**
 * Retention (V10): deletes the snapshots of finished runs (they hold the e-mail, the extracted
 * facts and the drafts) and their Langfuse traces. Called by Core's purge job.
 */
export async function purge(
  store: WorkflowsStore | undefined,
  request: z.infer<typeof PurgeRequestSchema>,
  deleteTrace: (traceId: string) => Promise<boolean> = deleteLangfuseTrace,
): Promise<{ runs: number; traces: number }> {
  let runs = 0;
  for (const runId of request.runIds) {
    for (const workflowName of WORKFLOW_NAMES) {
      try {
        await store?.deleteWorkflowRunById({ runId, workflowName });
      } catch {
        // already gone
      }
    }
    runs += 1;
  }
  let traces = 0;
  for (const traceId of request.traceIds) if (await deleteTrace(traceId)) traces += 1;
  return { runs, traces };
}

async function deleteLangfuseTrace(traceId: string): Promise<boolean> {
  if (env.TRACING_DISABLED || !env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) return false;
  try {
    const response = await fetch(new URL(`/api/public/traces/${traceId}`, env.LANGFUSE_BASE_URL), {
      method: 'DELETE',
      headers: {
        authorization: `Basic ${Buffer.from(`${env.LANGFUSE_PUBLIC_KEY}:${env.LANGFUSE_SECRET_KEY}`).toString('base64')}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function workflowsStore(mastra: Mastra): Promise<WorkflowsStore | undefined> {
  return (await mastra.getStorage()?.getStore('workflows')) as WorkflowsStore | undefined;
}
