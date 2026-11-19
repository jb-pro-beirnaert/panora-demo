import type { ApprovalDecision, ProcessEmailInput } from '@demo/shared';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../env.js';

/** Id of the workflow in the Mastra registry. */
export const PROCESS_EMAIL_WORKFLOW = 'processEmailWorkflow';

const TIMEOUT_MS = 10_000;

/**
 * One Langfuse trace and one session per case: the trace id is derived from the case id, so the
 * initial run and every resume land in the same trace.
 */
export interface CaseTracing {
  traceId: string;
  metadata: Record<string, string>;
}

export function caseTracing(caseId: string, metadata: Record<string, string> = {}): CaseTracing {
  return {
    traceId: caseId.replace(/-/g, '').toLowerCase(),
    metadata: { sessionId: caseId, caseId, ...metadata },
  };
}

/**
 * HTTP client of the Mastra server. Every call is fire-and-forget on the Mastra side: Core never
 * waits for a workflow to finish; progress comes back through the `/internal/*` callbacks.
 */
@Injectable()
export class MastraClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  private async post(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(new URL(path, this.env.MASTRA_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Mastra ${path} failed (${response.status}): ${await response.text()}`);
    }
    return response.json();
  }

  /** Creates a run (so its id can be stored before any step runs). */
  async createRun(): Promise<string> {
    const result = (await this.post(`/api/workflows/${PROCESS_EMAIL_WORKFLOW}/create-run`, {})) as {
      runId?: string;
    };
    if (!result.runId) throw new Error('Mastra create-run returned no runId');
    return result.runId;
  }

  /** Starts the run and returns immediately. */
  async start(runId: string, input: ProcessEmailInput, tracing: CaseTracing): Promise<void> {
    await this.post(
      `/api/workflows/${PROCESS_EMAIL_WORKFLOW}/start?runId=${encodeURIComponent(runId)}`,
      { inputData: input, tracingOptions: tracing },
    );
  }

  /** Resumes the run suspended on `approval` and returns immediately. */
  async resume(runId: string, decision: ApprovalDecision, tracing: CaseTracing): Promise<void> {
    await this.post(
      `/api/workflows/${PROCESS_EMAIL_WORKFLOW}/resume-no-wait?runId=${encodeURIComponent(runId)}`,
      { resumeData: decision, tracingOptions: tracing },
    );
  }
}
