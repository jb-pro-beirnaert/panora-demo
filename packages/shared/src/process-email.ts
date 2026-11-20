import { z } from 'zod';
import {
  HandoverReasonSchema,
  IsoDateSchema,
  LocaleSchema,
  RequestSubtypeSchema,
} from './domain.js';
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

/**
 * V15: the reply to the client as it will be sent, after execution: placeholders filled with the
 * insurer's answer (claim number, effective date) and the broker's approval comment applied.
 */
export const FinalDraftSchema = z.object({ subject: z.string(), body: z.string() });
export type FinalDraft = z.infer<typeof FinalDraftSchema>;

/** Final output of `process-email`. */
export const ProcessEmailResultSchema = z.discriminatedUnion('outcome', [
  /** Not a client request (spam, newsletter, supplier invoice): classified, no draft (V15). */
  z.object({
    outcome: z.literal('classified'),
    requestType: z.literal('unrelated'),
    subtype: RequestSubtypeSchema.nullable(),
  }),
  /** The agents could not handle the request: left to the broker (V15, "À traiter par vous"). */
  z.object({
    outcome: z.literal('handover'),
    reason: HandoverReasonSchema,
  }),
  /** Approved `cancel_policy`: the cancellation is recorded at the insurer (V15). */
  z.object({
    outcome: z.literal('cancellation_filed'),
    effectiveDate: IsoDateSchema,
    action: ProposedActionSchema,
    approvedBy: z.string(),
    finalDraft: FinalDraftSchema.nullable().default(null),
  }),
  /** Approved `file_claim`: the claim now exists at the insurer. */
  z.object({
    outcome: z.literal('claim_filed'),
    claimNumber: z.string(),
    action: ProposedActionSchema,
    approvedBy: z.string(),
    finalDraft: FinalDraftSchema.nullable().default(null),
  }),
  /** Approved e-mail (documents request or denial): ready to be sent (sending is out of scope). */
  z.object({
    outcome: z.literal('ready_to_send'),
    action: ProposedActionSchema,
    approvedBy: z.string(),
    finalDraft: FinalDraftSchema.nullable().default(null),
  }),
  /** V15: a follow-up without In-Reply-To, attached to the case it refers to. */
  z.object({
    outcome: z.literal('merged'),
    targetCaseId: z.string(),
  }),
]);
export type ProcessEmailResult = z.infer<typeof ProcessEmailResultSchema>;

/**
 * Input of the Mastra workflow `draft-reply` (V15), started by Core: a standalone reply that no
 * workflow waits for — the status of a case after a follow-up, or an acknowledgement — and its
 * re-draft after the broker rejected it with a comment.
 */
export const DraftReplyInputSchema = z.object({
  caseId: z.string().min(1),
  kind: z.enum(['send_status', 'acknowledge']),
  /** The e-mail the reply answers (a follow-up, or the case's e-mail). */
  email: InboundEmailInputSchema,
  brokerage: BrokerageContextSchema,
  /** What the brokerage knows about the case, as JSON text (status, last action, claim number…). */
  caseContext: z.string(),
  /** The rejected reply and the broker's comment, for a re-draft. */
  previous: z
    .object({ subject: z.string(), body: z.string(), comment: z.string().nullable() })
    .optional(),
});
export type DraftReplyInput = z.infer<typeof DraftReplyInputSchema>;
