import { z } from 'zod';
import {
  LocaleSchema,
  ActionTypeSchema,
  AlertTypeSchema,
  HandoverReasonSchema,
  IsoDateSchema,
  PerilSchema,
  RequestSubtypeSchema,
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
  /** V15: some of the documents only (an invoice without the incident report). */
  'partial_documents',
  /** V15 (demo script only): the same claim sent again while the first case is open. */
  'resent_claim',
  /** V18: an ordinary claim whose invoice hides instructions for the AI. */
  'prompt_injection',
]);
export type ClaimScenarioId = z.infer<typeof ClaimScenarioIdSchema>;

/** V15: the requests that are not claims, and what the demo must do with them. */
export const RequestScenarioIdSchema = z.enum([
  'cancellation',
  'cancellation_already_terminated',
  'cancellation_already_requested',
  'cancellation_late_notice',
  'coverage_question',
  'certificate_request',
  'quote_request',
  'spam',
  'newsletter',
  'supplier_invoice',
  /** Demo script only: they refer to an earlier e-mail of the script. */
  'follow_up',
  'follow_up_no_header',
]);
export type RequestScenarioId = z.infer<typeof RequestScenarioIdSchema>;

/** Every scenario of the catalog: claims, "unknown client" (#10) and the other requests (V15). */
export const ScenarioIdSchema = z.enum([
  ...ClaimScenarioIdSchema.options,
  'unknown_client',
  ...RequestScenarioIdSchema.options,
]);
export type ScenarioId = z.infer<typeof ScenarioIdSchema>;

/** The expected answer for a generated claim e-mail, fixed by the generator. Amounts in euros. */
export const ClaimGroundTruthSchema = z.object({
  scenario: ClaimScenarioIdSchema,
  requestType: z.literal('claim'),
  brokerCode: z.string(),
  /** Language of the e-mail (and of its attachments). */
  emailLanguage: LocaleSchema,
  /** Expected language of `clientEmailDraft`: the e-mail's language. */
  expectedDraftLanguage: LocaleSchema,
  /** Expected language of `internalNote`: the brokerage's locale. */
  expectedNoteLanguage: LocaleSchema,

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

/** Where an e-mail must end up (V15). */
export const ExpectedOutcomeSchema = z.enum([
  /** The agents propose an action and a reply. */
  'action',
  /** "À traiter par vous", with a handover reason (and an acknowledgement proposed). */
  'needs_broker',
  /** Spam, newsletter, supplier invoice: classified, no reply. */
  'classified',
]);
export type ExpectedOutcome = z.infer<typeof ExpectedOutcomeSchema>;

/** Expected answer for a request that is not a claim (V15). */
export const RequestGroundTruthSchema = z.object({
  scenario: RequestScenarioIdSchema,
  requestType: RequestTypeSchema.exclude(['claim']),
  subtype: RequestSubtypeSchema.nullable(),
  brokerCode: z.string(),
  /** Language of the e-mail (and of its attachments). */
  emailLanguage: LocaleSchema,
  /** Expected language of `clientEmailDraft`: the e-mail's language. */
  expectedDraftLanguage: LocaleSchema,
  /** Expected language of `internalNote`: the brokerage's locale. */
  expectedNoteLanguage: LocaleSchema,

  /** Company the e-mail is written for; null for spam and newsletters. */
  holderName: z.string().nullable(),
  /** Policy the e-mail is about, if any. */
  policyNumber: z.string().nullable(),
  policyNumberInEmail: z.boolean(),
  expectedOutcome: ExpectedOutcomeSchema,
  /** The action to propose; null when classified. */
  expectedAction: ActionTypeSchema.nullable(),
  handoverReason: HandoverReasonSchema.nullable(),
  alerts: z.array(AlertTypeSchema),
  /** Cancellation: the date it must take effect. */
  effectiveDate: IsoDateSchema.nullable(),
  /** Follow-up: message id of the e-mail it refers to. */
  followUpOf: z.string().nullable(),
});
export type RequestGroundTruth = z.infer<typeof RequestGroundTruthSchema>;

/**
 * Expected answer for a claim sent by someone who is not a client of the brokerage (#10): no
 * policy can be found, so the verdict is uncertain and the broker must identify the sender.
 */
export const UnknownClientGroundTruthSchema = z.object({
  scenario: z.literal('unknown_client'),
  requestType: z.literal('claim'),
  brokerCode: z.string(),
  /** Language of the e-mail (and of its attachments). */
  emailLanguage: LocaleSchema,
  /** Expected language of `clientEmailDraft`: the e-mail's language. */
  expectedDraftLanguage: LocaleSchema,
  /** Expected language of `internalNote`: the brokerage's locale. */
  expectedNoteLanguage: LocaleSchema,

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
  RequestGroundTruthSchema,
  UnknownClientGroundTruthSchema,
]);
export type GroundTruth = z.infer<typeof GroundTruthSchema>;
