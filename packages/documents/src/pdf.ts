import type { DocumentModel } from '@demo/shared';
import pdfmake from 'pdfmake';
import { documentContent } from './layouts.js';
import { printable } from './text.js';

/**
 * Real PDF attachments (V14). The world generator writes each document as page text, the text a
 * parser would extract; this module lays that text out as a PDF. The first line of a page is its
 * heading; `Label : value` lines are printed as fields.
 */

// Standard PDF fonts: no font file to embed, small files.
const HELVETICA = {
  normal: 'Helvetica',
  bold: 'Helvetica-Bold',
  italics: 'Helvetica-Oblique',
  bolditalics: 'Helvetica-BoldOblique',
};
pdfmake.setFonts({ Helvetica: HELVETICA });
// Documents never load external resources; the standard font names are the only "files" allowed.
const STANDARD_FONTS = new Set<string>(Object.values(HELVETICA));
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((path) => STANDARD_FONTS.has(path));

/** Fixed metadata date: the same text always gives the same bytes. */
const FIXED_DATE = new Date('2026-01-01T00:00:00Z');

/** Page markers used by the generated text and by `extractText`. */
const PAGE_MARKER = /^--- page \d+ ---$/m;

export function splitPages(text: string): string[] {
  const pages = text
    .split(PAGE_MARKER)
    .map((page) => page.trim())
    .filter((page) => page.length > 0);
  return pages.length > 0 ? pages : [text.trim()];
}

function pageContent(page: string, index: number, last: boolean) {
  const [heading = '', ...lines] = page.split('\n');
  const content: unknown[] = [];
  if (index === 0) content.push({ text: printable(heading), style: 'heading' });
  else lines.unshift(heading);
  for (const line of lines) {
    const field = /^([^:]{2,40}) : (.*)$/.exec(line);
    content.push(
      field
        ? { text: [{ text: `${printable(field[1]!)} : `, bold: true }, printable(field[2]!)] }
        : { text: printable(line) || ' ' },
    );
  }
  if (!last) content.push({ text: '', pageBreak: 'after' });
  return content;
}

/** Lays out page text as a PDF (A4, one PDF page per `--- page N ---` block). */
export async function renderPdf(title: string, text: string): Promise<Buffer> {
  const pages = splitPages(text);
  const document = pdfmake.createPdf({
    info: { title, creationDate: FIXED_DATE, modDate: FIXED_DATE },
    pageSize: 'A4',
    pageMargins: [56, 64, 56, 64],
    defaultStyle: { font: 'Helvetica', fontSize: 10.5, lineHeight: 1.35 },
    styles: { heading: { fontSize: 14, bold: true, margin: [0, 0, 0, 14] } },
    content: pages.flatMap((page, index) => pageContent(page, index, index === pages.length - 1)),
    footer: (current: number, count: number) => ({
      text: `${current} / ${count}`,
      alignment: 'center',
      fontSize: 8,
      color: '#888888',
    }),
  });
  const buffer: Uint8Array = await document.getBuffer();
  return Buffer.from(buffer);
}

/**
 * V16: lays out a structured document (invoice, incident report, police receipt, fire report) as a
 * real-looking PDF. Same model, same bytes.
 */
export async function renderDocument(title: string, model: DocumentModel): Promise<Buffer> {
  const document = pdfmake.createPdf({
    info: { title, creationDate: FIXED_DATE, modDate: FIXED_DATE },
    pageSize: 'A4',
    pageMargins: [48, 48, 48, 56],
    defaultStyle: { font: 'Helvetica', fontSize: 10, lineHeight: 1.2 },
    content: documentContent(model),
    footer: (current: number, count: number) => ({
      text: `${current} / ${count}`,
      alignment: 'center',
      fontSize: 8,
      color: '#888888',
    }),
  });
  return Buffer.from(await document.getBuffer());
}
