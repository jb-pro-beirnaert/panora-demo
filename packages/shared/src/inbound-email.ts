import { z } from 'zod';

/**
 * An attachment as the agents see it: the text extracted from the file (V14: by Core, from the
 * real PDF). Pages are separated by `--- page N ---` markers.
 */
export const AttachmentInputSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  extractedText: z.string(),
});
export type AttachmentInput = z.infer<typeof AttachmentInputSchema>;

/** An e-mail as the agents process it (input of the `process-email` workflow). */
export const InboundEmailInputSchema = z.object({
  messageId: z.string().min(1),
  from: z.email(),
  to: z.email(),
  subject: z.string(),
  body: z.string(),
  receivedAt: z.iso.datetime(),
  attachments: z.array(AttachmentInputSchema),
});
export type InboundEmailInput = z.infer<typeof InboundEmailInputSchema>;

/** File types a brokerage accepts as attachments (V14). */
export const ATTACHMENT_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;

/** An attached file as it arrives in the inbox: the real bytes, base64-encoded (V14). */
export const RawAttachmentSchema = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.enum(ATTACHMENT_CONTENT_TYPES),
  contentBase64: z
    .base64()
    .refine((value) => (value.length * 3) / 4 <= MAX_ATTACHMENT_BYTES, 'attachment over 2 MB'),
});
export type RawAttachment = z.infer<typeof RawAttachmentSchema>;

/** An e-mail as it arrives in the inbox (`POST /emails` on Core), with its files (V14). */
export const RawEmailInputSchema = InboundEmailInputSchema.extend({
  attachments: z.array(RawAttachmentSchema).max(MAX_ATTACHMENTS),
});
export type RawEmailInput = z.infer<typeof RawEmailInputSchema>;
