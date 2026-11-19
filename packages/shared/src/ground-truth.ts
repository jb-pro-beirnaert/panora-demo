import { z } from 'zod';
import {
  ActionTypeSchema,
  AlertTypeSchema,
  PerilSchema,
  RequestTypeSchema,
  RequiredDocumentSchema,
  VerdictSchema,
} from './domain.js';

/** Claim scenarios of the catalog (`specs/00-demo-data-and-scenarios.md` §2) available so far. */
export const ClaimScenarioIdSchema = z.enum([
  'covered',
  'policy_terminated',
  'exclusion',
  'limit_exceeded',
  'deductible',
  'missing_document',
  'duplicate_claim',
  'unreadable_field',
  'late_declaration',
]);
export type ClaimScenarioId = z.infer<typeof ClaimScenarioIdSchema>;

/** Every scenario of the catalog available so far: the claim scenarios, "not a claim" (#8) and "unknown client" (#10). */
export const ScenarioIdSchema = z.enum([
  ...ClaimScenarioIdSchema.options,
  'non_claim',
  'unknown_client',
]);
export type ScenarioId = z.infer<typeof ScenarioIdSchema>;

/** The expected answer for a generated claim e-mail, fixed by the generator. Amounts in euros. */
export const ClaimGroundTruthSchema = z.object({
  scenario: ClaimScenarioIdSchema,
  requestType: z.literal('claim'),
  brokerCode: z.string(),
  holderName: z.string(),
  policyNumber: z.string(),
  /** Whether the policy number is written in the e-mail or its attachments. */
  policyNumberInEmail: z.boolean(),
  incidentDate: z.iso.date(),
  /** Whether the incident date can be read unambiguously. */
  incidentDateReadable: z.boolean(),
  nature: PerilSchema,
  /** Null when the e-mail gives no readable amount. */
  amount: z.number().nullable(),
  documentsMissing: z.array(RequiredDocumentSchema),
  verdict: VerdictSchema,
  /** Main reason for the verdict. */
  reason: ClaimScenarioIdSchema,
  alerts: z.array(AlertTypeSchema),
  coverageLabel: z.string(),
  limit: z.number(),
  deductible: z.number(),
  /** The clause the verdict must cite. */
  clauseRef: z.string(),
  /** The action `draftingAgent` should propose. */
  expectedAction: ActionTypeSchema,
});
export type ClaimGroundTruth = z.infer<typeof ClaimGroundTruthSchema>;

/** Expected answer for an e-mail that is not a claim: classified, no coverage analysis. */
export const NonClaimGroundTruthSchema = z.object({
  scenario: z.literal('non_claim'),
  requestType: RequestTypeSchema.exclude(['claim']),
  brokerCode: z.string(),
  holderName: z.string(),
  /** Policy the e-mail is about (a cancellation), or null (a quote request). */
  policyNumber: z.string().nullable(),
  policyNumberInEmail: z.boolean(),
});
export type NonClaimGroundTruth = z.infer<typeof NonClaimGroundTruthSchema>;

/**
 * Expected answer for a claim sent by someone who is not a client of the brokerage (#10): no
 * policy can be found, so the verdict is uncertain and the broker must identify the sender.
 */
export const UnknownClientGroundTruthSchema = z.object({
  scenario: z.literal('unknown_client'),
  requestType: z.literal('claim'),
  brokerCode: z.string(),
  holderName: z.string(),
  policyNumber: z.null(),
  policyNumberInEmail: z.literal(false),
  nature: PerilSchema,
  amount: z.number().nullable(),
  verdict: z.literal('uncertain'),
  alerts: z.array(AlertTypeSchema),
  expectedAction: z.literal('request_documents'),
});
export type UnknownClientGroundTruth = z.infer<typeof UnknownClientGroundTruthSchema>;

export const GroundTruthSchema = z.discriminatedUnion('scenario', [
  ClaimGroundTruthSchema,
  NonClaimGroundTruthSchema,
  UnknownClientGroundTruthSchema,
]);
export type GroundTruth = z.infer<typeof GroundTruthSchema>;
