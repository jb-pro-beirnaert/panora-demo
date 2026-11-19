import {
  ApprovalDecisionSchema,
  BrokerageContextSchema,
  ClientLookupResultSchema,
  DraftSchema,
  RunOptionsSchema,
  CoverageVerdictSchema,
  InboundEmailInputSchema,
  ProposedActionSchema,
  TriageResultSchema,
} from '@demo/shared';
import { z } from 'zod';

/** Schemas passed between the steps of `process-email` and `handle-claim` (internal to Mastra). */

export const PreparedEmailSchema = z.object({
  /** Core case to report to; null when the workflow is run by hand (Mastra Studio). */
  caseId: z.string().nullable(),
  email: InboundEmailInputSchema,
  brokerage: BrokerageContextSchema,
  /** Eval run options (models, architecture, context); absent in normal runs. */
  options: RunOptionsSchema.optional(),
  /** The e-mail and its attachments as one text, with named sections the agents cite as sources. */
  rendered: z.string(),
  receivedDate: z.iso.date(),
});
export type PreparedEmail = z.infer<typeof PreparedEmailSchema>;

export const TriagedEmailSchema = PreparedEmailSchema.extend({
  triage: TriageResultSchema,
  /** What the brokerage's software knows about the sender (`find_client`); null if unknown. */
  client: ClientLookupResultSchema.nullable(),
  /** Single-agent architecture (V8): the verdict and first draft, already produced at triage. */
  precomputed: z.object({ coverage: CoverageVerdictSchema, draft: DraftSchema }).optional(),
});
export type TriagedEmail = z.infer<typeof TriagedEmailSchema>;

/** One proposal and the broker's decision on it. */
export const ApprovalRoundSchema = z.object({
  action: ProposedActionSchema,
  decision: ApprovalDecisionSchema,
});
export type ApprovalRound = z.infer<typeof ApprovalRoundSchema>;

/** State of the draft → approval loop: input and output of each `draft-and-approve` iteration. */
export const ClaimLoopStateSchema = z.object({
  claim: TriagedEmailSchema,
  coverage: CoverageVerdictSchema,
  /** Every decided proposal, oldest first. The loop ends when the last one is approved. */
  rounds: z.array(ApprovalRoundSchema),
});
export type ClaimLoopState = z.infer<typeof ClaimLoopStateSchema>;

export const DraftedStateSchema = ClaimLoopStateSchema.extend({ action: ProposedActionSchema });
export type DraftedState = z.infer<typeof DraftedStateSchema>;

/** Payload of `suspend()` in the `approval` step: what the broker reviews. */
export const ApprovalSuspendSchema = z.object({ action: ProposedActionSchema });
