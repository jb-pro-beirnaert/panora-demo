import { z } from 'zod';
import {
  AlertTypeSchema,
  HandoverReasonSchema,
  IsoDateSchema,
  PolicyStatusSchema,
} from './domain.js';

/**
 * Output of `policyServiceAgent` (V15): a cancellation or a question about a policy, checked
 * against the brokerage's records and the insurer's extranet.
 */
export const ServiceAnalysisSchema = z.object({
  /** `proposal`: the agents can handle it; `handover`: the broker must (see `handoverReason`). */
  outcome: z.enum(['proposal', 'handover']),
  handoverReason: HandoverReasonSchema.nullable(),
  policyNumber: z.string().nullable(),
  /** The policy as the insurer sees it. */
  policyStatus: PolicyStatusSchema.nullable(),
  /** Next renewal date at the insurer, `YYYY-MM-DD`. */
  renewalDate: IsoDateSchema.nullable(),
  /** Cancellation: the date it takes effect (a renewal date). Null otherwise. */
  effectiveDate: IsoDateSchema.nullable(),
  alerts: z.array(AlertTypeSchema),
  /** Question: the answer in a few sentences, with the figures (limit, deductible, exclusions). */
  answer: z.string().nullable(),
  citations: z
    .array(
      z.object({
        clauseRef: z.string(),
        /** Word for word, in the clause's language. */
        excerpt: z.string(),
      }),
    )
    .default([]),
  /** Two or three sentences for the broker: what was checked and what it shows. */
  summary: z.string().min(1),
});
export type ServiceAnalysis = z.infer<typeof ServiceAnalysisSchema>;
