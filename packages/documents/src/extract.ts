import { getDocumentProxy } from 'unpdf';

export interface ExtractionResult {
  /** Text page by page, with `--- page N ---` markers; empty when the extraction failed. */
  text: string;
  pageCount: number;
  status: 'ok' | 'failed';
}

/** Characters sent to the LLM per attachment: enough for a claim document, bounded for cost. */
export const MAX_EXTRACTED_CHARS = 8_000;

interface TextItem {
  str: string;
  transform: number[];
  width: number;
}

/** Two items whose baselines are this close (in points) are on the same line. */
const SAME_LINE = 3;
/** A horizontal gap wider than this separates two columns. */
const COLUMN_GAP = 14;

/**
 * Reading order of a page (V16): items grouped by baseline from top to bottom, then left to right.
 * Columns and table cells side by side end up on the same line, separated by wide spaces, as a
 * human reads a form or an invoice.
 */
export function orderLines(items: TextItem[]): string[] {
  const placed = items
    .filter((item) => item.str.trim() !== '')
    .map((item) => ({
      text: item.str,
      x: item.transform[4]!,
      y: item.transform[5]!,
      width: item.width,
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: (typeof placed)[] = [];
  for (const item of placed) {
    const line = lines.at(-1);
    if (line && Math.abs(line[0]!.y - item.y) <= SAME_LINE) line.push(item);
    else lines.push([item]);
  }
  return lines.map((line) => {
    line.sort((a, b) => a.x - b.x);
    let text = '';
    let end = -Infinity;
    for (const item of line) {
      const gap = item.x - end;
      if (text) text += gap > COLUMN_GAP ? '   ' : gap > 1 && !/\s$/.test(text) ? ' ' : '';
      text += item.text;
      end = item.x + item.width;
    }
    return text.replace(/[ \t]+$/g, '');
  });
}

/**
 * Text of a PDF, page by page (V14), in reading order (V16): the agents only ever get this text,
 * never the file. A PDF without a text layer (a scan) or a corrupt file gives `status: 'failed'`.
 */
export async function extractText(pdf: Uint8Array): Promise<ExtractionResult> {
  try {
    const document = await getDocumentProxy(new Uint8Array(pdf));
    const pages: string[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const lines = orderLines(content.items as TextItem[]);
      // Page footers ("1 / 2") are layout, not content.
      if (lines.length > 0 && /^\d+ \/ \d+$/.test(lines.at(-1)!.trim())) lines.pop();
      pages.push(lines.join('\n').trim());
    }
    if (pages.every((page) => page === '')) {
      return { text: '', pageCount: document.numPages, status: 'failed' };
    }
    let joined = pages.map((page, index) => `--- page ${index + 1} ---\n${page}`).join('\n');
    if (joined.length > MAX_EXTRACTED_CHARS) {
      joined = `${joined.slice(0, MAX_EXTRACTED_CHARS)}\n[… text truncated: document too long]`;
    }
    return { text: joined, pageCount: document.numPages, status: 'ok' };
  } catch {
    return { text: '', pageCount: 0, status: 'failed' };
  }
}
