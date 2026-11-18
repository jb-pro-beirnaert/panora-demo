import { z } from 'zod';

/** Language-neutral business vocabulary shared by every service. */

export const LocaleSchema = z.enum(['fr']);
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

export const RequestTypeSchema = z.enum(['claim', 'quote_request', 'cancellation', 'other']);
export type RequestType = z.infer<typeof RequestTypeSchema>;

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
]);
export type AlertType = z.infer<typeof AlertTypeSchema>;

/** Calendar date, `YYYY-MM-DD`. */
export const IsoDateSchema = z.iso.date();
