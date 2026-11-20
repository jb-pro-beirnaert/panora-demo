import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';

export interface ExtractionResult {
  /** Text page by page, with `--- page N ---` markers; empty when the extraction failed. */
  text: string;
  pageCount: number;
  status: 'ok' | 'failed';
}

/** Characters sent to the LLM per attachment: enough for a claim document, bounded for cost. */
export const MAX_EXTRACTED_CHARS = 8_000;

function tidy(page: string): string {
  return page
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Text of a PDF, page by page (V14): the agents only ever get this text, never the file. A PDF
 * without a text layer (a scan) or a corrupt file gives `status: 'failed'`.
 */
export async function extractText(pdf: Uint8Array): Promise<ExtractionResult> {
  try {
    const document = await getDocumentProxy(new Uint8Array(pdf));
    const { totalPages, text } = await extractPdfText(document, { mergePages: false });
    const pages = (text as string[]).map(tidy);
    // Page footers ("1 / 2") are layout, not content.
    const content = pages.map((page) => page.replace(/\n?\d+ \/ \d+$/, '').trim());
    if (content.every((page) => page === ''))
      return { text: '', pageCount: totalPages, status: 'failed' };
    let joined = content.map((page, index) => `--- page ${index + 1} ---\n${page}`).join('\n');
    if (joined.length > MAX_EXTRACTED_CHARS) {
      joined = `${joined.slice(0, MAX_EXTRACTED_CHARS)}\n[… text truncated: document too long]`;
    }
    return { text: joined, pageCount: totalPages, status: 'ok' };
  } catch {
    return { text: '', pageCount: 0, status: 'failed' };
  }
}
