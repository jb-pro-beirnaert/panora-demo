import { z } from 'zod';
import {
  ActionTypeSchema,
  ClaimStatusSchema,
  IsoDateSchema,
  LocaleSchema,
  PolicyEndReasonSchema,
  PolicyStatusSchema,
} from './domain.js';

/**
 * V17: what the broker can open — the insurer's extranet (read-only `/portal/*` routes of the
 * extranet, served to the UI by Core's `/insurer/*`) and the brokerage's client base (`/clients`).
 */

export const InsurerRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  locale: LocaleSchema,
});

/** A policy as the insurer sees it (list row). */
export const InsurerPolicySummarySchema = z.object({
  number: z.string(),
  insurer: InsurerRefSchema,
  holderName: z.string(),
  product: z.string(),
  status: PolicyStatusSchema,
  startDate: IsoDateSchema,
  endDate: IsoDateSchema.nullable(),
  endReason: PolicyEndReasonSchema.nullable(),
  renewalDate: IsoDateSchema,
  cancellationRequestedAt: IsoDateSchema.nullable(),
});
export type InsurerPolicySummary = z.infer<typeof InsurerPolicySummarySchema>;

export const InsurerPolicyDetailSchema = InsurerPolicySummarySchema.extend({
  holderSiren: z.string(),
  coverages: z.array(
    z.object({
      peril: z.string(),
      label: z.string(),
      limit: z.number(),
      deductible: z.number(),
      exclusions: z.array(z.string()),
      clauseRef: z.string(),
    }),
  ),
  generalClauses: z.array(z.object({ ref: z.string(), title: z.string() })),
  claims: z.array(
    z.object({
      number: z.string(),
      date: IsoDateSchema,
      nature: z.string(),
      amount: z.number(),
      status: ClaimStatusSchema,
      description: z.string(),
      /** The brokerage that filed it through the connector (null for the insurer's history). */
      filedBy: z.string().nullable(),
    }),
  ),
});
export type InsurerPolicyDetail = z.infer<typeof InsurerPolicyDetailSchema>;

/** Core adds what the brokerage knows about the policy, to compare with the insurer. */
export const InsurerPolicyViewSchema = InsurerPolicyDetailSchema.extend({
  brokerage: z
    .object({
      knownStatus: PolicyStatusSchema,
      renewalDate: IsoDateSchema,
      cancellationEffectiveDate: IsoDateSchema.nullable(),
      client: z.object({ id: z.string(), companyName: z.string() }),
    })
    .nullable(),
});
export type InsurerPolicyView = z.infer<typeof InsurerPolicyViewSchema>;

/** The general conditions of an insurer, every clause in full. */
export const InsurerClausesSchema = z.object({
  insurer: InsurerRefSchema,
  clauses: z.array(
    z.object({ ref: z.string(), title: z.string(), text: z.string(), general: z.boolean() }),
  ),
});
export type InsurerClauses = z.infer<typeof InsurerClausesSchema>;

/** The brokerage's client base (Core). */
export const ClientSummarySchema = z.object({
  id: z.string(),
  companyName: z.string(),
  siren: z.string(),
  contactName: z.string(),
  email: z.string(),
  policies: z.number().int(),
  cases: z.number().int(),
});
export type ClientSummary = z.infer<typeof ClientSummarySchema>;

export const ClientDetailSchema = ClientSummarySchema.omit({ policies: true, cases: true }).extend({
  policies: z.array(
    z.object({
      number: z.string(),
      insurerName: z.string(),
      product: z.string(),
      knownStatus: PolicyStatusSchema,
      renewalDate: IsoDateSchema,
      cancellationEffectiveDate: IsoDateSchema.nullable(),
    }),
  ),
  cases: z.array(
    z.object({
      id: z.string(),
      reference: z.string(),
      receivedAt: z.string(),
      subject: z.string(),
      requestType: z.string().nullable(),
      status: z.string(),
      lastAction: ActionTypeSchema.nullable(),
    }),
  ),
});
export type ClientDetail = z.infer<typeof ClientDetailSchema>;
