import { z } from 'zod';
import {
  ClaimStatusSchema,
  IsoDateSchema,
  LocaleSchema,
  PerilSchema,
  PolicyEndReasonSchema,
  PolicyStatusSchema,
} from './domain.js';

/** Insurer-side part of the world, sent by the simulator to `POST /admin/seed` of the MCP server. */

export const ExtranetInsurerSchema = z.object({
  id: z.string(),
  name: z.string(),
  locale: LocaleSchema,
});
export type ExtranetInsurer = z.infer<typeof ExtranetInsurerSchema>;

export const ExtranetClauseSchema = z.object({
  ref: z.string(),
  insurerId: z.string(),
  title: z.string(),
  text: z.string(),
  /** True for general clauses that apply to the whole policy (declaration delay, termination…). */
  general: z.boolean(),
});
export type ExtranetClause = z.infer<typeof ExtranetClauseSchema>;

export const ExtranetCoverageSchema = z.object({
  peril: PerilSchema,
  label: z.string(),
  limit: z.number().int().nonnegative(),
  deductible: z.number().int().nonnegative(),
  exclusions: z.array(z.string()),
  clauseRef: z.string(),
});
export type ExtranetCoverage = z.infer<typeof ExtranetCoverageSchema>;

export const ExtranetPolicySchema = z.object({
  number: z.string(),
  insurerId: z.string(),
  holderName: z.string(),
  holderSiren: z.string().regex(/^\d{9}$/),
  brokerCode: z.string(),
  product: z.string(),
  status: PolicyStatusSchema,
  startDate: IsoDateSchema,
  endDate: IsoDateSchema.nullable(),
  endReason: PolicyEndReasonSchema.nullable(),
  /** V15: next renewal date (a cancellation by the client takes effect on a renewal). */
  renewalDate: IsoDateSchema,
  /** V15: when the client's cancellation was recorded (the policy stays active until `endDate`). */
  cancellationRequestedAt: IsoDateSchema.nullable().default(null),
  coverages: z.array(ExtranetCoverageSchema),
});
export type ExtranetPolicy = z.infer<typeof ExtranetPolicySchema>;

export const ExtranetClaimSchema = z.object({
  number: z.string(),
  policyNumber: z.string(),
  date: IsoDateSchema,
  nature: PerilSchema,
  amount: z.number().int().nonnegative(),
  status: ClaimStatusSchema,
  description: z.string(),
});
export type ExtranetClaim = z.infer<typeof ExtranetClaimSchema>;

export const ExtranetSeedSchema = z.object({
  insurers: z.array(ExtranetInsurerSchema),
  clauses: z.array(ExtranetClauseSchema),
  policies: z.array(ExtranetPolicySchema),
  claims: z.array(ExtranetClaimSchema),
});
export type ExtranetSeed = z.infer<typeof ExtranetSeedSchema>;
