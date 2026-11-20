import { z } from 'zod';

/** Language-neutral business vocabulary shared by every service. */

/** Languages of the demo: UI, generated data, e-mails, clauses. */
export const LocaleSchema = z.enum(['fr', 'en']);
export type Locale = z.infer<typeof LocaleSchema>;

/** Kind of damage. Used for coverages, claims and triage extraction. */
export const PerilSchema = z.enum([
  'water_damage',
  'fire',
  'theft',
  'glass_breakage',
  'vehicle_damage',
]);
export type Peril = z.infer<typeof PerilSchema>;

export const PolicyStatusSchema = z.enum(['active', 'suspended', 'terminated']);
export type PolicyStatus = z.infer<typeof PolicyStatusSchema>;

export const PolicyEndReasonSchema = z.enum([
  'non_payment',
  'client_request',
  'insurer_termination',
]);
export type PolicyEndReason = z.infer<typeof PolicyEndReasonSchema>;

export const ClaimStatusSchema = z.enum(['open', 'settled', 'rejected']);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

/** Type of a document attached to an e-mail. */
export const DocumentTypeSchema = z.enum([
  'incident_report',
  'invoice',
  'quote',
  'police_report',
  'fire_report',
  'photos',
  'other',
]);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

/** A document the insurer requires before a claim can be processed. */
export const RequiredDocumentSchema = z.enum([
  'incident_report',
  'invoice_or_quote',
  'police_report',
  'fire_report',
]);
export type RequiredDocument = z.infer<typeof RequiredDocumentSchema>;

/** Documents required per peril. Single source of truth for the generator and the prompts. */
export const REQUIRED_DOCUMENTS: Record<Peril, RequiredDocument[]> = {
  water_damage: ['incident_report', 'invoice_or_quote'],
  fire: ['fire_report', 'invoice_or_quote'],
  theft: ['police_report', 'invoice_or_quote'],
  glass_breakage: ['invoice_or_quote'],
  vehicle_damage: ['incident_report', 'invoice_or_quote'],
};

const SATISFIED_BY: Record<RequiredDocument, DocumentType[]> = {
  incident_report: ['incident_report'],
  invoice_or_quote: ['invoice', 'quote'],
  police_report: ['police_report'],
  fire_report: ['fire_report'],
};

/** Required documents for `peril` that none of the `present` documents satisfies. */
export function missingDocuments(peril: Peril, present: DocumentType[]): RequiredDocument[] {
  return REQUIRED_DOCUMENTS[peril].filter(
    (required) => !SATISFIED_BY[required].some((type) => present.includes(type)),
  );
}

/** What the sender asks for (V15: every request type gets an outcome). */
export const RequestTypeSchema = z.enum([
  'claim',
  'cancellation',
  'information',
  'quote_request',
  /** "Further to my e-mail…": about a case the brokerage already has. */
  'follow_up',
  /** Spam, newsletter, supplier invoice: not a client request. */
  'unrelated',
]);
export type RequestType = z.infer<typeof RequestTypeSchema>;

/** Detail of an `information` or `unrelated` request (V15). */
export const RequestSubtypeSchema = z.enum([
  'coverage_question',
  'certificate',
  'spam',
  'newsletter',
  'supplier_invoice',
]);
export type RequestSubtype = z.infer<typeof RequestSubtypeSchema>;

/** Why the agents leave a case to the broker ("À traiter par vous", V15). */
export const HandoverReasonSchema = z.enum([
  'certificate_request',
  'quote_request',
  'policy_not_found',
  'policy_of_other_client',
  'question_not_answerable',
  'follow_up_unmatched',
  'unclassified',
  'workflow_failed',
]);
export type HandoverReason = z.infer<typeof HandoverReasonSchema>;

export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const VerdictSchema = z.enum(['covered', 'not_covered', 'uncertain']);
export type Verdict = z.infer<typeof VerdictSchema>;

export const AlertTypeSchema = z.enum([
  'policy_terminated',
  'exclusion',
  'limit_exceeded',
  'late_declaration',
  'missing_document',
  'duplicate_claim',
  /** The sender is not a client of the brokerage: the broker must identify them. */
  'unknown_client',
  /** V15 cancellations: the policy is already terminated at the insurer. */
  'already_terminated',
  /** V15: a cancellation is already scheduled at the insurer. */
  'cancellation_already_requested',
  /** V15: the notice period is not met, the cancellation takes effect at the following renewal. */
  'notice_period_not_met',
]);
export type AlertType = z.infer<typeof AlertTypeSchema>;

/** Calendar date, `YYYY-MM-DD`. */
export const IsoDateSchema = z.iso.date();

/** Action `draftingAgent` proposes to the broker. */
export const ActionTypeSchema = z.enum([
  'request_documents',
  'file_claim',
  'notify_denial',
  /** V15: cancel a policy at the insurer (MCP `request_cancellation` after approval). */
  'cancel_policy',
  /** V15: answer a question about a coverage, with the clause cited. */
  'answer_question',
  /** V15: tell the client where their request stands (follow-up, already terminated…). */
  'send_status',
  /** V15: acknowledgement of receipt; the broker handles the request. */
  'acknowledge',
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;
