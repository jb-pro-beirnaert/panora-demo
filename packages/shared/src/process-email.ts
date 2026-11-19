import { z } from 'zod';
import { LocaleSchema, RequestTypeSchema } from './domain.js';
import { ProposedActionSchema } from './drafting.js';
import { InboundEmailInputSchema } from './inbound-email.js';

/** The brokerage whose claims inbox received the e-mail. */
export const BrokerageContextSchema = z.object({
  /** Scopes the MCP extranet tokens: the agents only see this brokerage's policies. */
  brokerCode: z.string().min(1),
  /** Language of the internal note written for the broker. */
  locale: LocaleSchema,
});
export type BrokerageContext = z.infer<typeof BrokerageContextSchema>;

/**
 * A model spec: a Mastra model id (`openai/gpt-5-nano`) or `ollama/<model>` for a local model served
 * by Ollama (OpenAI-compatible API, V8).
 */
export const ModelSpecSchema = z.string().regex(/^[a-z0-9-]+\/.+$/);

/**
 * Per-case run options, used by the eval matrix (V8) to compare models, architectures and
 * optimisations without restarting the Mastra server. Core accepts them only in demo mode.
 */
export const RunOptionsSchema = z.object({
  models: z
    .object({
      triage: ModelSpecSchema.optional(),
      coverage: ModelSpecSchema.optional(),
      drafting: ModelSpecSchema.optional(),
    })
    .optional(),
  /** Three specialised agents (default) or a single agent doing everything. */
  architecture: z.enum(['three_agents', 'single_agent']).optional(),
  /** `reduced`: attachments trimmed to their useful pages, no attachments for the drafting agent. */
  context: z.enum(['full', 'reduced']).optional(),
});
export type RunOptions = z.infer<typeof RunOptionsSchema>;

/** Input of the Mastra workflow `process-email`. */
export const ProcessEmailInputSchema = z.object({
  /**
   * Core case the run belongs to: steps are reported to Core's `/internal/cases/:caseId/*` routes.
   * Absent when the workflow is run by hand (Mastra Studio): nothing is reported.
   */
  caseId: z.string().min(1).optional(),
  email: InboundEmailInputSchema,
  brokerage: BrokerageContextSchema,
  options: RunOptionsSchema.optional(),
});
export type ProcessEmailInput = z.infer<typeof ProcessEmailInputSchema>;

/** Final output of `process-email`. */
export const ProcessEmailResultSchema = z.discriminatedUnion('outcome', [
  /** Not a claim: classified, no coverage analysis, no draft. */
  z.object({
    outcome: z.literal('classified'),
    requestType: RequestTypeSchema.exclude(['claim']),
  }),
  /** Approved `file_claim`: the claim now exists at the insurer. */
  z.object({
    outcome: z.literal('claim_filed'),
    claimNumber: z.string(),
    action: ProposedActionSchema,
    approvedBy: z.string(),
  }),
  /** Approved e-mail (documents request or denial): ready to be sent (sending is out of scope). */
  z.object({
    outcome: z.literal('ready_to_send'),
    action: ProposedActionSchema,
    approvedBy: z.string(),
  }),
]);
export type ProcessEmailResult = z.infer<typeof ProcessEmailResultSchema>;
