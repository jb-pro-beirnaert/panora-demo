import {
  ClientLookupResultSchema,
  ProcessEmailInputSchema,
  ProcessEmailResultSchema,
  TriageResultSchema,
  type InboundEmailInput,
  type ProcessEmailInput,
  type ProcessEmailResult,
} from '@demo/shared';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { reportToolCalls } from '../core-callbacks/agent-events.js';
import { core } from '../core-callbacks/core-client.js';
import { classifiedReport, triageReport } from '../core-callbacks/step-reports.js';
import { env } from '../env.js';
import { CLIENT_LOOKUP_KEY } from '../mcp/extranet-client.js';
import { lookupClient } from '../tools/find-client.js';
import { annotateSpan, caseContext } from './context.js';
import { handleClaimWorkflow } from './handle-claim.js';
import { PreparedEmailSchema, TriagedEmailSchema } from './schemas.js';

/** find_client + the structured answer. */
const TRIAGE_MAX_STEPS = 4;

function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function renderEmail(email: InboundEmailInput): string {
  const attachments = email.attachments.map(
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
      rendered: renderEmail(inputData.email),
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
    const requestContext = caseContext(inputData.brokerage.brokerCode, inputData.caseId);
    annotateSpan(tracingContext, 'triage', env.TRIAGE_MODEL);
    const startedAt = Date.now();
    const response = await mastra
      .getAgent('triageAgent')
      .generate(`Extract the facts from this e-mail.\n\n${inputData.rendered}`, {
        maxSteps: TRIAGE_MAX_STEPS,
        structuredOutput: { schema: TriageResultSchema },
        requestContext,
        tracingContext,
        onStepFinish: reportToolCalls(inputData.caseId, 'triage'),
      });
    const triageResult = TriageResultSchema.parse(response.object);
    // The model is asked to call find_client; if it did not, look the sender up anyway.
    if (!requestContext.has(CLIENT_LOOKUP_KEY)) {
      await lookupClient(requestContext, inputData.email.from);
    }
    const client = ClientLookupResultSchema.nullable().parse(
      requestContext.get(CLIENT_LOOKUP_KEY) ?? null,
    );
    annotateSpan(tracingContext, 'triage', env.TRIAGE_MODEL, {
      emailLanguage: triageResult.emailLanguage,
    });
    await core.step(
      inputData.caseId,
      triageReport(triageResult, {
        model: env.TRIAGE_MODEL,
        durationMs: Date.now() - startedAt,
        usage: response.usage,
      }),
    );
    return { ...inputData, triage: triageResult, client };
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
