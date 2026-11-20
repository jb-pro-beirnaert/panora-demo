import type { InboundEmailInput, RawAttachment, RawEmailInput } from '@demo/shared';
import { extractText } from './extract.js';
import { renderPdf } from './pdf.js';
import { PHOTO_JPEG_BASE64 } from './photo.js';

export interface ExtractedAttachment {
  extractedText: string;
  pageCount: number | null;
  sizeBytes: number;
  extractionStatus: 'ok' | 'failed' | 'not_applicable';
}

/**
 * Turns a generated e-mail (attachments as page text) into the e-mail a client would send: PDFs
 * laid out from that text, a generic JPEG for photos (V14).
 */
export async function toRawEmail(email: InboundEmailInput): Promise<RawEmailInput> {
  const attachments = await Promise.all(
    email.attachments.map(async (attachment): Promise<RawAttachment> => {
      if (attachment.contentType.startsWith('image/')) {
        return {
          fileName: attachment.fileName,
          contentType: 'image/jpeg',
          contentBase64: PHOTO_JPEG_BASE64,
        };
      }
      const pdf = await renderPdf(attachment.fileName, attachment.extractedText);
      return {
        fileName: attachment.fileName,
        contentType: 'application/pdf',
        contentBase64: pdf.toString('base64'),
      };
    }),
  );
  return { ...email, attachments };
}

/**
 * What the agents get from a file: the text of a PDF, or a short mention for an image (images are
 * not analysed). A PDF whose text cannot be extracted is mentioned as unreadable.
 */
export async function extractAttachment(attachment: RawAttachment): Promise<ExtractedAttachment> {
  const bytes = Buffer.from(attachment.contentBase64, 'base64');
  if (attachment.contentType !== 'application/pdf') {
    return {
      extractedText: `[image not analyzed: ${attachment.fileName}]`,
      pageCount: null,
      sizeBytes: bytes.length,
      extractionStatus: 'not_applicable',
    };
  }
  const result = await extractText(bytes);
  return {
    extractedText:
      result.status === 'ok' ? result.text : `[unreadable attachment: ${attachment.fileName}]`,
    pageCount: result.pageCount || null,
    sizeBytes: bytes.length,
    extractionStatus: result.status,
  };
}

/** The e-mail as the agents process it: every file replaced by its extracted text. */
export async function extractEmail(email: RawEmailInput): Promise<InboundEmailInput> {
  const attachments = await Promise.all(
    email.attachments.map(async (attachment) => ({
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      extractedText: (await extractAttachment(attachment)).extractedText,
    })),
  );
  return { ...email, attachments };
}
