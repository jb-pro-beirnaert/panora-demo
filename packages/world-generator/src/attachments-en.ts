import type { AttachmentInput, DocumentType } from '@demo/shared';
import { buildDocument, type AttachmentContext } from './attachments.js';

/** Attachments of English-speaking clients: the same documents, in English (V16). */
export function buildAttachmentEn(type: DocumentType, ctx: AttachmentContext): AttachmentInput {
  return buildDocument(type, ctx, 'en');
}
