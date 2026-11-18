import {
  ProcessEmailInputSchema,
  ProcessEmailResultSchema,
  TriageResultSchema,
  type InboundEmailInput,
  type ProcessEmailResult,
} from '@demo/shared';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { handleClaimWorkflow } from './handle-claim.js';
import { PreparedEmailSchema, TriagedEmailSchema } from './schemas.js';

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
  execute: async ({ inputData }) => ({
    email: inputData.email,
    brokerage: inputData.brokerage,
    rendered: renderEmail(inputData.email),
    receivedDate: inputData.email.receivedAt.slice(0, 10),
  }),
});

const triage = createStep({
  id: 'triage',
  description: 'triageAgent classifies the e-mail and extracts the claim facts.',
  inputSchema: PreparedEmailSchema,
  outputSchema: TriagedEmailSchema,
  execute: async ({ inputData, mastra }) => {
    const response = await mastra
      .getAgent('triageAgent')
      .generate(`Extract the facts from this e-mail.\n\n${inputData.rendered}`, {
        structuredOutput: { schema: TriageResultSchema },
      });
    return { ...inputData, triage: TriageResultSchema.parse(response.object) };
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

/**
 * prepare → triage → not a claim: classify (end) | claim: handle-claim (coverage analysis,
 * draft/approval loop with human approval, execute).
 */
export const processEmailWorkflow = createWorkflow({
  id: 'process-email',
  description:
    'Processes one inbound e-mail: triage, then for a claim coverage analysis, a proposed action approved by a broker, and its execution.',
  inputSchema: ProcessEmailInputSchema,
  outputSchema: ProcessEmailResultSchema,
})
  .then(prepare)
  .then(triage)
  .branch([
    [async ({ inputData }) => inputData.triage.requestType !== 'claim', classify],
    [async ({ inputData }) => inputData.triage.requestType === 'claim', handleClaimWorkflow],
  ])
  .then(collectResult)
  .commit();
