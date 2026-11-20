import { z } from 'zod';
import { ActionTypeSchema } from './domain.js';
import { FileClaimInputSchema, RequestCancellationInputSchema } from './extranet-tools.js';

/** Output of `draftingAgent`. Free text follows the language rules passed in the agent input. */
export const DraftSchema = z.object({
  actionType: ActionTypeSchema,
  /** E-mail to the client, in the language of the inbound e-mail. */
  clientEmailDraft: z.object({
    subject: z.string().min(1),
    body: z.string().min(1),
  }),
  /** Note for the broker, in the brokerage's language (`Brokerage.locale`). */
  internalNote: z.string().min(1),
});
export type Draft = z.infer<typeof DraftSchema>;

/** The action submitted to the broker for approval. */
export const ProposedActionSchema = DraftSchema.extend({
  /** 1 for the first proposal, +1 after each rejection. */
  revision: z.number().int().positive(),
  /**
   * Arguments of the MCP `file_claim` call run after approval, built by code from the triage and
   * the coverage verdict (never by the LLM). Null unless `actionType` is `file_claim`.
   */
  claimFiling: FileClaimInputSchema.nullable(),
  /**
   * Arguments of the MCP `request_cancellation` call run after approval (V15), built by code from
   * the service analysis. Null unless `actionType` is `cancel_policy`.
   */
  cancellation: RequestCancellationInputSchema.nullable().default(null),
});
export type ProposedAction = z.infer<typeof ProposedActionSchema>;

/** The broker's decision on a proposed action: the `resumeSchema` of the `approval` step. */
export const ApprovalDecisionSchema = z.object({
  approved: z.boolean(),
  /** Why the proposal is rejected, or what to change. Fed back to `draftingAgent`. */
  comment: z.string().trim().min(1).optional(),
  brokerId: z.string().trim().min(1),
  /** V18: the broker confirmed the prompt-injection alert (checked again before execution). */
  injectionAcknowledged: z.boolean().optional(),
});
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
