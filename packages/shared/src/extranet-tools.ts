import { z } from 'zod';
import { ClaimStatusSchema, IsoDateSchema, PerilSchema } from './domain.js';

/** Scope of an MCP extranet token: `read` gives the 5 read tools, `write` adds `file_claim`. */
export const McpTokenScopeSchema = z.enum(['read', 'write']);
export type McpTokenScope = z.infer<typeof McpTokenScopeSchema>;

/** Arguments of the MCP write tool `file_claim`. Amounts in euros. */
export const FileClaimInputSchema = z.object({
  policyNumber: z.string().trim().min(1),
  /** Incident date, `YYYY-MM-DD`. */
  date: IsoDateSchema,
  nature: PerilSchema,
  /** Amount claimed, taxes included. */
  amount: z.number().positive(),
  /** File names of the supporting documents sent with the declaration. */
  documents: z.array(z.string().min(1)),
  /** Short description of the circumstances. */
  description: z.string().trim().min(1).max(2_000).optional(),
});
export type FileClaimInput = z.infer<typeof FileClaimInputSchema>;

/** Result of `file_claim`. */
export const FileClaimResultSchema = z.object({
  claimNumber: z.string(),
  policyNumber: z.string(),
  status: ClaimStatusSchema,
  /** True when an identical claim was already filed: the call is idempotent. */
  alreadyFiled: z.boolean(),
});
export type FileClaimResult = z.infer<typeof FileClaimResultSchema>;

/** Arguments of the MCP write tool `request_cancellation` (V15). */
export const RequestCancellationInputSchema = z.object({
  policyNumber: z.string().trim().min(1),
  /** Date the cancellation takes effect: a renewal date of the policy, `YYYY-MM-DD`. */
  effectiveDate: IsoDateSchema,
  reason: z.literal('client_request'),
});
export type RequestCancellationInput = z.infer<typeof RequestCancellationInputSchema>;

/** Result of `request_cancellation`. */
export const RequestCancellationResultSchema = z.object({
  policyNumber: z.string(),
  effectiveDate: IsoDateSchema,
  /** True when the same cancellation was already recorded: the call is idempotent. */
  alreadyRequested: z.boolean(),
});
export type RequestCancellationResult = z.infer<typeof RequestCancellationResultSchema>;
