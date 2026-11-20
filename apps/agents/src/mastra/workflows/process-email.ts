import {
  ClientLookupResultSchema,
  CoverageVerdictSchema,
  DraftSchema,
  ProcessEmailInputSchema,
  ProcessEmailResultSchema,
  TriageResultSchema,
  type HandoverReason,
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
import { handOver, handleServiceWorkflow } from './handle-service.js';
import { PreparedEmailSchema, TriagedEmailSchema, type TriagedEmail } from './schemas.js';

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
    'Not a client request (spam, newsletter, supplier invoice): recorded and closed, no reply.',
  inputSchema: TriagedEmailSchema,
  outputSchema: ProcessEmailResultSchema,
  execute: async ({ inputData }): Promise<ProcessEmailResult> => {
    const { requestType, subtype } = inputData.triage;
    if (requestType !== 'unrelated') throw new Error('classify only handles unrelated e-mails');
    await core.step(inputData.caseId, classifiedReport(requestType, subtype));
    return { outcome: 'classified', requestType, subtype };
  },
});

/** Requests the agents cannot handle at all: a quote, a certificate (V15). */
function directHandoverReason(triaged: TriagedEmail): HandoverReason | null {
  if (triaged.triage.requestType === 'quote_request') return 'quote_request';
  if (triaged.triage.requestType === 'information' && triaged.triage.subtype === 'certificate') {
    return 'certificate_request';
  }
  return null;
}

const handover = createStep({
  id: 'handover',
  description:
    'A quote or a certificate: the agents propose an acknowledgement and the broker takes over.',
  inputSchema: TriagedEmailSchema,
  outputSchema: ProcessEmailResultSchema,
  execute: async ({ inputData, mastra, tracingContext, runId }): Promise<ProcessEmailResult> => {
    const reason = directHandoverReason(inputData) ?? 'unclassified';
    await handOver({ request: inputData, reason, mastra, tracingContext, runId });
    return { outcome: 'handover', reason };
  },
});

/**
 * A follow-up without In-Reply-To (V15): the case it refers to is looked up among the sender's
 * recent cases (a cited reference first, else the newest open one). Found: the e-mail is attached
 * to it. Not found: the broker must handle it.
 */
const matchFollowUp = createStep({
  id: 'match-follow-up',
  description: "Finds the case a follow-up refers to among the sender's recent cases.",
  inputSchema: TriagedEmailSchema,
  outputSchema: ProcessEmailResultSchema,
  execute: async ({ inputData, mastra, tracingContext, runId }): Promise<ProcessEmailResult> => {
    const cases = inputData.caseId
      ? await core.findClientCases(inputData.email.from, inputData.caseId)
      : [];
    const reference = inputData.triage.caseReference;
    const candidates = cases.filter((kase) => kase.status !== 'merged');
    const match =
      (reference && candidates.find((kase) => kase.reference === reference)) ||
      candidates.find((kase) => kase.requestType !== 'unrelated');
    if (match) {
      await core.step(inputData.caseId, {
        agent: 'triage',
        stepType: 'triage.follow_up_matched',
        params: { reference: match.reference },
        sources: [{ kind: 'core', ref: 'find_client_cases' }],
      });
      return { outcome: 'merged', targetCaseId: match.caseId };
    }
    await core.step(inputData.caseId, {
      agent: 'triage',
      stepType: 'triage.follow_up_unmatched',
      params: { cases: cases.length },
      sources: [{ kind: 'core', ref: 'find_client_cases' }],
    });
    await handOver({
      request: inputData,
      reason: 'follow_up_unmatched',
      mastra,
      tracingContext,
      runId,
    });
    return { outcome: 'handover', reason: 'follow_up_unmatched' };
  },
});

const collectResult = createStep({
  id: 'collect-result',
  description: 'Returns the result of the branch that ran.',
  inputSchema: z.object({
    classify: ProcessEmailResultSchema.optional(),
    handover: ProcessEmailResultSchema.optional(),
    'match-follow-up': ProcessEmailResultSchema.optional(),
    'handle-claim': ProcessEmailResultSchema.optional(),
    'handle-service': ProcessEmailResultSchema.optional(),
  }),
  outputSchema: ProcessEmailResultSchema,
  execute: async ({ inputData }) => {
    const result =
      inputData.classify ??
      inputData.handover ??
      inputData['match-follow-up'] ??
      inputData['handle-claim'] ??
      inputData['handle-service'];
    if (!result) throw new Error('no branch produced a result');
    return result;
  },
});

function caseIdOf(getInitData: () => unknown): string | undefined {
  return (getInitData() as ProcessEmailInput | undefined)?.caseId;
}

/**
 * prepare → triage → claim: handle-claim (coverage analysis, draft/approval loop with human
 * approval, execute) | cancellation or question: handle-service | follow-up: attached to its case
 * | quote or certificate: handed over to the broker | unrelated: classified (V15). The final result and failures are reported
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
    [async ({ inputData }) => inputData.triage.requestType === 'claim', handleClaimWorkflow],
    [async ({ inputData }) => inputData.triage.requestType === 'unrelated', classify],
    [async ({ inputData }) => inputData.triage.requestType === 'follow_up', matchFollowUp],
    [async ({ inputData }) => directHandoverReason(inputData) !== null, handover],
    [
      async ({ inputData }) =>
        inputData.triage.requestType === 'cancellation' ||
        (inputData.triage.requestType === 'information' &&
          inputData.triage.subtype !== 'certificate'),
      handleServiceWorkflow,
    ],
  ])
  .then(collectResult)
  .commit();
