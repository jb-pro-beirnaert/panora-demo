import {
  CoverageVerdictSchema,
  InboundEmailInputSchema,
  TriageResultSchema,
  type InboundEmailInput,
} from '@demo/shared';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

/** Upper bound on LLM round-trips for the coverage agent (about 7 tool calls + the answer). */
const COVERAGE_MAX_STEPS = 16;

const PreparedEmailSchema = z.object({
  email: InboundEmailInputSchema,
  /** The e-mail and its attachments as one text, with named sections the agents cite as sources. */
  rendered: z.string(),
  receivedDate: z.iso.date(),
});

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
  inputSchema: InboundEmailInputSchema,
  outputSchema: PreparedEmailSchema,
  execute: async ({ inputData }) => ({
    email: inputData,
    rendered: renderEmail(inputData),
    receivedDate: inputData.receivedAt.slice(0, 10),
  }),
});

const triage = createStep({
  id: 'triage',
  description: 'triageAgent classifies the e-mail and extracts the claim facts.',
  inputSchema: PreparedEmailSchema,
  outputSchema: PreparedEmailSchema.extend({ triage: TriageResultSchema }),
  execute: async ({ inputData, mastra }) => {
    const response = await mastra
      .getAgent('triageAgent')
      .generate(`Extract the facts from this e-mail.\n\n${inputData.rendered}`, {
        structuredOutput: { schema: TriageResultSchema },
      });
    return { ...inputData, triage: TriageResultSchema.parse(response.object) };
  },
});

const analyzeCoverage = createStep({
  id: 'analyze-coverage',
  description: "coverageAgent checks the claim against the insurer's extranet through MCP.",
  inputSchema: PreparedEmailSchema.extend({ triage: TriageResultSchema }),
  outputSchema: z.object({ triage: TriageResultSchema, coverage: CoverageVerdictSchema }),
  execute: async ({ inputData, mastra }) => {
    const prompt = [
      `The e-mail was received on ${inputData.receivedDate}.`,
      `Facts extracted by the triage agent (JSON):\n${JSON.stringify(inputData.triage, null, 2)}`,
      `The e-mail:\n\n${inputData.rendered}`,
    ].join('\n\n');
    const response = await mastra.getAgent('coverageAgent').generate(prompt, {
      maxSteps: COVERAGE_MAX_STEPS,
      structuredOutput: { schema: CoverageVerdictSchema },
    });
    return { triage: inputData.triage, coverage: CoverageVerdictSchema.parse(response.object) };
  },
});

/**
 * V1: prepare → triage → analyze-coverage. The non-claim branch, drafting and human approval
 * arrive in V2.
 */
export const processEmailWorkflow = createWorkflow({
  id: 'process-email',
  description: 'Processes one inbound e-mail: triage, then coverage analysis at the insurer.',
  inputSchema: InboundEmailInputSchema,
  outputSchema: z.object({ triage: TriageResultSchema, coverage: CoverageVerdictSchema }),
})
  .then(prepare)
  .then(triage)
  .then(analyzeCoverage)
  .commit();
