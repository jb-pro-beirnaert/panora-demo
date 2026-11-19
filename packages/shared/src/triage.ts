import { z } from 'zod';
import {
  ConfidenceSchema,
  LocaleSchema,
  DocumentTypeSchema,
  PerilSchema,
  RequestTypeSchema,
  RequiredDocumentSchema,
} from './domain.js';

/** Where an extracted value was read. */
export const FieldSourceSchema = z.object({
  /** `email_body`, `email_subject`, or the attachment file name. */
  document: z.string(),
  /** 1-based page number inside an attachment; null for the e-mail itself. */
  page: z.number().int().nullable(),
});
export type FieldSource = z.infer<typeof FieldSourceSchema>;

function extracted<T extends z.ZodType>(value: T) {
  return z.object({
    /** Null when the value is absent or unreadable. */
    value: value.nullable(),
    /** Null when the value is absent. */
    source: FieldSourceSchema.nullable(),
    confidence: ConfidenceSchema,
  });
}

/** Output of `triageAgent`. */
export const TriageResultSchema = z.object({
  requestType: RequestTypeSchema,
  /** Language the e-mail is written in (its body, not the attachments). */
  emailLanguage: LocaleSchema,
  /** Company or person the e-mail is sent on behalf of (the policy holder). */
  holderName: extracted(z.string()),
  policyNumber: extracted(z.string()),
  /** `YYYY-MM-DD`. */
  incidentDate: extracted(z.string()),
  nature: extracted(PerilSchema),
  location: extracted(z.string()),
  /** Claimed amount in euros, taxes included. */
  amount: extracted(z.number()),
  documentsPresent: z.array(
    z.object({
      type: DocumentTypeSchema,
      fileName: z.string(),
    }),
  ),
  documentsMissing: z.array(RequiredDocumentSchema),
});
export type TriageResult = z.infer<typeof TriageResultSchema>;
