import { z } from 'zod';
import {
  AlertTypeSchema,
  PerilSchema,
  RequestTypeSchema,
  RequiredDocumentSchema,
  VerdictSchema,
} from './domain.js';

/** Scenarios of the catalog (`specs/00-demo-data-and-scenarios.md` §2) available so far. */
export const ScenarioIdSchema = z.enum([
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
export type ScenarioId = z.infer<typeof ScenarioIdSchema>;

/** The expected answer for a generated e-mail, fixed by the generator. Amounts in euros. */
export const GroundTruthSchema = z.object({
  scenario: ScenarioIdSchema,
  requestType: RequestTypeSchema,
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
  reason: z.union([ScenarioIdSchema, z.literal('covered')]),
  alerts: z.array(AlertTypeSchema),
  coverageLabel: z.string(),
  limit: z.number(),
  deductible: z.number(),
  /** The clause the verdict must cite. */
  clauseRef: z.string(),
});
export type GroundTruth = z.infer<typeof GroundTruthSchema>;
