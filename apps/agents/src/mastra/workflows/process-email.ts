import {
  ClientLookupResultSchema,
  CoverageVerdictSchema,
  DraftSchema,
  ProcessEmailInputSchema,
  ProcessEmailResultSchema,
  TriageResultSchema,
  type InboundEmailInput,
  type ProcessEmailInput,
  type ProcessEmailResult,
  type RunOptions,
} from '@demo/shared';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { reportStepStarted, reportToolCalls } from '../core-callbacks/agent-events.js';
import { core } from '../core-callbacks/core-client.js';
import { classifiedReport, triageReport } from '../core-callbacks/step-reports.js';
import { env } from '../env.js';
import { modelSpecOf } from '../models.js';
import { simulateTriage } from '../simulated/agents.js';
import { CLIENT_LOOKUP_KEY } from '../mcp/extranet-client.js';
import { lookupClient } from '../tools/find-client.js';
import { annotateSpan, caseContext } from './context.js';
import { handleClaimWorkflow } from './handle-claim.js';
import { PreparedEmailSchema, TriagedEmailSchema } from './schemas.js';

/** find_client + the structured answer. */
const TRIAGE_MAX_STEPS = 4;
/** find_client, the coverage tool calls and the answer. */
const SINGLE_AGENT_MAX_STEPS = 18;

const SingleAgentResultSchema = z.object({
  triage: TriageResultSchema,
  coverage: CoverageVerdictSchema,
  draft: DraftSchema,
});

function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/**
 * Reduced context (V8 optimisation): photos carry no fact the agents need, and blank lines and
 * signature padding are dropped from attachments.
 */
export function usefulAttachments(email: InboundEmailInput, options?: RunOptions) {
  if (options?.context !== 'reduced') return email.attachments;
  return email.attachments
    .filter((attachment) => !attachment.contentType.startsWith('image/'))
    .map((attachment) => ({
      ...attachment,
      extractedText: attachment.extractedText
        .split('\n')
        .filter((line) => line.trim() !== '')
        .join('\n'),
    }));
}

export function renderEmail(email: InboundEmailInput, options?: RunOptions): string {
  const attachments = usefulAttachments(email, options).map(
    (attachment) =>
      `=== attachment: ${attachment.fileName} (${attachment.contentType}) ===\n${normalizeText(attachment.extractedText)}`,
  );
  return [
    `Received at: ${email.receivedAt}`,
    `From: ${email.from}`,
    `To: ${email.to}`,
    `=== email_subject ===\n${normalizeText(email.subject)}`,
    `=== email_body ===\n${normalizeText(email.body)}`,
    ...(attachments.length > 0 ? attachments : ['(no attachment)']),
  ].join('\n\n');
}

const prepare = createStep({
  id: 'prepare',
  description: 'Normalizes the e-mail and the text of its attachments into one document.',
  inputSchema: ProcessEmailInputSchema,
  outputSchema: PreparedEmailSchema,
  execute: async ({ inputData }) => {
    const caseId = inputData.caseId ?? null;
    await core.step(caseId, {
      agent: 'system',
      stepType: 'prepare.completed',
      params: { attachments: inputData.email.attachments.length },
    });
    return {
      caseId,
      email: inputData.email,
      brokerage: inputData.brokerage,
      ...(inputData.options ? { options: inputData.options } : {}),
      rendered: renderEmail(inputData.email, inputData.options),
      receivedDate: inputData.email.receivedAt.slice(0, 10),
    };
  },
});

const triage = createStep({
  id: 'triage',
  description:
    'triageAgent looks the sender up (find_client), classifies the e-mail and extracts the claim facts.',
  inputSchema: PreparedEmailSchema,
  outputSchema: TriagedEmailSchema,
  execute: async ({ inputData, mastra, tracingContext }) => {
    const requestContext = caseContext(
      inputData.brokerage.brokerCode,
      inputData.caseId,
      inputData.options,
    );
    const single = inputData.options?.architecture === 'single_agent';
    const model = modelSpecOf(single ? 'coverage' : 'triage', requestContext);
    annotateSpan(tracingContext, single ? 'single' : 'triage', model);
    await reportStepStarted(inputData.caseId, 'triage', { model });
    const startedAt = Date.now();
    let triageResult;
    let precomputed;
    let usage;
    if (env.AGENTS_MODE === 'simulated') {
      triageResult = await simulateTriage(
        inputData.email,
        inputData.receivedDate,
        env.SIMULATED_LLM_LATENCY_MS,
      );
    } else if (single) {
      // V8 comparison: one agent produces the triage, the verdict and the first draft at once.
      const response = await mastra
        .getAgent('singleAgent')
        .generate(
          [
            `The e-mail was received on ${inputData.receivedDate}.`,
            `Brokerage locale (language of the internal note): "${inputData.brokerage.locale}".`,
            `The e-mail:\n\n${inputData.rendered}`,
          ].join('\n\n'),
          {
            maxSteps: SINGLE_AGENT_MAX_STEPS,
            structuredOutput: { schema: SingleAgentResultSchema },
            requestContext,
            tracingContext,
            onStepFinish: reportToolCalls(inputData.caseId, 'coverage'),
            abortSignal: AbortSignal.timeout(env.LLM_TIMEOUT_MS),
          },
        );
      const result = SingleAgentResultSchema.parse(response.object);
      triageResult = result.triage;
      precomputed = { coverage: result.coverage, draft: result.draft };
      usage = response.usage;
    } else {
      const response = await mastra
        .getAgent('triageAgent')
        .generate(`Extract the facts from this e-mail.\n\n${inputData.rendered}`, {
          maxSteps: TRIAGE_MAX_STEPS,
          structuredOutput: { schema: TriageResultSchema },
          requestContext,
          tracingContext,
          onStepFinish: reportToolCalls(inputData.caseId, 'triage'),
          abortSignal: AbortSignal.timeout(env.LLM_TIMEOUT_MS),
        });
      triageResult = TriageResultSchema.parse(response.object);
      usage = response.usage;
    }
    // The model is asked to call find_client; if it did not, look the sender up anyway.
    if (!requestContext.has(CLIENT_LOOKUP_KEY)) {
      await lookupClient(requestContext, inputData.email.from);
    }
    const client = ClientLookupResultSchema.nullable().parse(
      requestContext.get(CLIENT_LOOKUP_KEY) ?? null,
    );
    annotateSpan(tracingContext, single ? 'single' : 'triage', model, {
      emailLanguage: triageResult.emailLanguage,
    });
    await core.step(
      inputData.caseId,
      triageReport(triageResult, { model, durationMs: Date.now() - startedAt, usage }),
    );
    return { ...inputData, triage: triageResult, client, ...(precomputed ? { precomputed } : {}) };
  },
});

const classify = createStep({
  id: 'classify',
  description:
    'Not a claim: records the request type and ends the workflow (no coverage analysis).',
  inputSchema: TriagedEmailSchema,
  outputSchema: ProcessEmailResultSchema,
  execute: async ({ inputData }): Promise<ProcessEmailResult> => {
    const { requestType } = inputData.triage;
    if (requestType === 'claim') throw new Error('classify only handles non-claim e-mails');
    await core.step(inputData.caseId, classifiedReport(requestType));
    return { outcome: 'classified', requestType };
  },
});

const collectResult = createStep({
  id: 'collect-result',
  description: 'Returns the result of the branch that ran.',
  inputSchema: z.object({
    classify: ProcessEmailResultSchema.optional(),
    'handle-claim': ProcessEmailResultSchema.optional(),
  }),
  outputSchema: ProcessEmailResultSchema,
  execute: async ({ inputData }) => {
    const result = inputData.classify ?? inputData['handle-claim'];
    if (!result) throw new Error('no branch produced a result');
    return result;
  },
});

function caseIdOf(getInitData: () => unknown): string | undefined {
  return (getInitData() as ProcessEmailInput | undefined)?.caseId;
}

/**
 * prepare → triage → not a claim: classify (end) | claim: handle-claim (coverage analysis,
 * draft/approval loop with human approval, execute). The final result and failures are reported
 * to Core from the workflow's lifecycle callbacks.
 */
export const processEmailWorkflow = createWorkflow({
  id: 'process-email',
  description:
    'Processes one inbound e-mail: triage, then for a claim coverage analysis, a proposed action approved by a broker, and its execution.',
  inputSchema: ProcessEmailInputSchema,
  outputSchema: ProcessEmailResultSchema,
  // Transient failures (LLM API, extranet, timeouts): each step is retried before the run fails.
  retryConfig: { attempts: env.WORKFLOW_STEP_ATTEMPTS, delay: 2_000 },
  options: {
    onFinish: async ({ status, result, runId, getInitData }) => {
      if (status !== 'success') return;
      const parsed = ProcessEmailResultSchema.safeParse(result);
      if (parsed.success) {
        await core.executedAction(caseIdOf(getInitData), {
          workflowRunId: runId,
          result: parsed.data,
        });
      }
    },
    onError: async ({ error, runId, getInitData }) => {
      await core.failed(caseIdOf(getInitData), {
        workflowRunId: runId,
        error: error?.message ?? 'workflow failed',
      });
    },
  },
})
  .then(prepare)
  .then(triage)
  .branch([
    [async ({ inputData }) => inputData.triage.requestType !== 'claim', classify],
    [async ({ inputData }) => inputData.triage.requestType === 'claim', handleClaimWorkflow],
  ])
  .then(collectResult)
  .commit();
