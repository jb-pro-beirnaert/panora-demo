import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractAttachment, extractEmail, extractText, renderPdf, toRawEmail } from './index.js';

const TEXT = [
  '--- page 1 ---',
  'CONSTAT AMIABLE DE DÉGÂT DES EAUX',
  'Assuré : Boulangerie Martin — SIREN 123 456 789',
  'Date du sinistre : 12 novembre 2026',
  '--- page 2 ---',
  'Circonstances : fuite au plafond, 1 450,00 €',
  'Total TTC : ▒ ▒▒▒,▒▒ €',
].join('\n');

test('renders a real, reproducible PDF', async () => {
  const first = await renderPdf('constat.pdf', TEXT);
  const second = await renderPdf('constat.pdf', TEXT);
  assert.equal(first.subarray(0, 5).toString(), '%PDF-');
  assert.equal(Buffer.compare(first, second), 0);
});

test('extracts the text page by page, as the generator wrote it', async () => {
  const result = await extractText(await renderPdf('constat.pdf', TEXT));
  assert.equal(result.status, 'ok');
  assert.equal(result.pageCount, 2);
  assert.match(result.text, /^--- page 1 ---\nCONSTAT AMIABLE DE DÉGÂT DES EAUX/);
  assert.match(result.text, /--- page 2 ---\nCirconstances : fuite au plafond, 1 450,00 €/);
  // Masked values stay masked.
  assert.match(result.text, /Total TTC : # ###,## €/);
});

test('a corrupt file is reported as unreadable', async () => {
  const extracted = await extractAttachment({
    fileName: 'facture.pdf',
    contentType: 'application/pdf',
    contentBase64: Buffer.from('not a pdf').toString('base64'),
  });
  assert.equal(extracted.extractionStatus, 'failed');
  assert.equal(extracted.extractedText, '[unreadable attachment: facture.pdf]');
});

test('round trip: generated e-mail → files → text for the agents', async () => {
  const email = {
    messageId: '<1@test>',
    from: 'a@b.fr',
    to: 'c@d.fr',
    subject: 'Dégât des eaux',
    body: 'Bonjour',
    receivedAt: '2026-11-18T08:00:00Z',
    attachments: [
      { fileName: 'constat.pdf', contentType: 'application/pdf', extractedText: TEXT },
      { fileName: 'photos.jpg', contentType: 'image/jpeg', extractedText: '[Photo] dégâts' },
    ],
  };
  const raw = await toRawEmail(email);
  assert.equal(raw.attachments[1]!.contentType, 'image/jpeg');
  const extracted = await extractEmail(raw);
  assert.match(extracted.attachments[0]!.extractedText, /Boulangerie Martin/);
  assert.equal(extracted.attachments[1]!.extractedText, '[image not analyzed: photos.jpg]');
});
