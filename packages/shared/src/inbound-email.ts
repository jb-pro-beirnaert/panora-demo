import { z } from 'zod';

/** A simulated attachment: the text a document parser would have extracted from the file. */
export const AttachmentInputSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  /** Extracted text. Pages are separated by `--- page N ---` markers. */
  extractedText: z.string(),
});
export type AttachmentInput = z.infer<typeof AttachmentInputSchema>;

/** An e-mail received by a brokerage's claims inbox. */
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
