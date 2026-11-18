import { z } from 'zod';
import { AlertTypeSchema, PerilSchema, PolicyStatusSchema, VerdictSchema } from './domain.js';

export const CitationSchema = z.object({
  clauseRef: z.string(),
  /** Verbatim excerpt of the clause, in the clause's original language. */
  excerpt: z.string(),
});
export type Citation = z.infer<typeof CitationSchema>;

/** Output of `coverageAgent`. Amounts are in euros. */
export const CoverageVerdictSchema = z.object({
  verdict: VerdictSchema,
  /** Policy the verdict is about; null when no policy could be identified. */
  policyNumber: z.string().nullable(),
  /** Status at the insurer (may differ from what the brokerage believes). */
  policyStatus: PolicyStatusSchema.nullable(),
  coverage: z
    .object({
      label: z.string(),
      peril: PerilSchema,
      clauseRef: z.string(),
    })
    .nullable(),
  limit: z.number().nullable(),
  deductible: z.number().nullable(),
  claimedAmount: z.number().nullable(),
  /** min(claimedAmount, limit) - deductible, floored at 0; null when unknown or not covered. */
  estimatedPayout: z.number().nullable(),
  citations: z.array(CitationSchema),
  alerts: z.array(AlertTypeSchema),
  /** Short factual justification of the verdict, in English. */
  reasoning: z.string(),
});
export type CoverageVerdict = z.infer<typeof CoverageVerdictSchema>;
