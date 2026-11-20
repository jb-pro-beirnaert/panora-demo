import { detectLanguage, type EvalScore, type GroundTruth } from '@demo/shared';
import type { Observed } from '../lib/observed.js';

const score = (scorer: string, value: number | null, comment?: string): EvalScore => ({
  agent: 'drafting',
  scorer,
  value,
  ...(comment ? { comment } : {}),
});

/**
 * Euro amounts written in a text: `1 450 €`, `1,450.00 EUR`, `€2,300`, `EUR 300`. Returns whole
 * euros (cents dropped).
 */
export function amountsIn(text: string): number[] {
  const pattern =
    /(?:€|EUR)\s?(\d{1,3}(?:[   .,]\d{3})*(?:[.,]\d{1,2})?)|(\d{1,3}(?:[   .,]\d{3})*(?:[.,]\d{1,2})?)\s?(?:€|EUR|euros?)/gi;
  const amounts: number[] = [];
  for (const match of text.matchAll(pattern)) {
    const raw = (match[1] ?? match[2] ?? '').trim();
    // A 1-2 digit group after the last separator is cents; any other separator groups thousands.
    const decimal = /[.,](\d{1,2})$/.exec(raw);
    const units = decimal ? raw.slice(0, -decimal[0].length) : raw;
    const value = Number(units.replace(/[^\d]/g, ''));
    if (!Number.isNaN(value)) amounts.push(value);
  }
  return amounts;
}

/** Amounts the draft may legitimately mention for this case. */
export function knownAmounts(truth: GroundTruth): Set<number> {
  const known = new Set<number>();
  if ('amount' in truth && truth.amount !== null) known.add(Math.round(truth.amount));
  if (truth.requestType === 'claim' && truth.scenario !== 'unknown_client') {
    known.add(truth.limit);
    known.add(truth.deductible);
    if (truth.amount !== null) {
      const payout = Math.max(0, Math.min(truth.amount, truth.limit) - truth.deductible);
      known.add(Math.round(payout));
      known.add(Math.min(truth.amount, truth.limit));
    }
  }
  return known;
}

/** actionType, amounts copied without error, languages of the draft and of the note. */
export function scoreDrafting(truth: GroundTruth, observed: Observed): EvalScore[] {
  const proposal = observed.proposal;
  if (truth.requestType !== 'claim') {
    // V15: unrelated e-mails get no reply; every other request gets one, in the right language.
    if (truth.expectedAction === null) {
      return [
        score('action_type', proposal ? 0 : 1, proposal ? 'unexpected reply' : 'ok'),
        score('amounts', null),
        score('languages', null),
      ];
    }
    if (!proposal) {
      return [
        score('action_type', 0, 'no proposal'),
        score('amounts', null),
        score('languages', 0, 'no proposal'),
      ];
    }
    const draftLanguage = detectLanguage(`${proposal.draftSubject}\n${proposal.draftBody}`);
    const noteLanguage = detectLanguage(proposal.internalNote);
    return [
      score(
        'action_type',
        proposal.actionType === truth.expectedAction ? 1 : 0,
        `expected ${truth.expectedAction}, got ${proposal.actionType}`,
      ),
      score('amounts', null),
      score(
        'languages',
        (draftLanguage === truth.expectedDraftLanguage ? 0.5 : 0) +
          (noteLanguage === truth.expectedNoteLanguage ? 0.5 : 0),
        `draft ${draftLanguage}/${truth.expectedDraftLanguage}, note ${noteLanguage}/${truth.expectedNoteLanguage}`,
      ),
    ];
  }
  if (!proposal) {
    return [
      score('action_type', 0, 'no proposal'),
      score('amounts', 0, 'no proposal'),
      score('languages', 0, 'no proposal'),
    ];
  }
  const known = knownAmounts(truth);
  const text = `${proposal.draftSubject}\n${proposal.draftBody}\n${proposal.internalNote}`;
  const wrong = amountsIn(text).filter((amount) => amount >= 10 && !known.has(amount));
  const draftLanguage = detectLanguage(`${proposal.draftSubject}\n${proposal.draftBody}`);
  const noteLanguage = detectLanguage(proposal.internalNote);
  const languages =
    (draftLanguage === truth.expectedDraftLanguage ? 0.5 : 0) +
    (noteLanguage === truth.expectedNoteLanguage ? 0.5 : 0);
  return [
    score(
      'action_type',
      proposal.actionType === truth.expectedAction ? 1 : 0,
      `expected ${truth.expectedAction}, got ${proposal.actionType}`,
    ),
    score(
      'amounts',
      wrong.length === 0 ? 1 : 0,
      wrong.length === 0 ? 'ok' : `unknown amounts: ${wrong.join(', ')}`,
    ),
    score(
      'languages',
      languages,
      `draft ${draftLanguage}/${truth.expectedDraftLanguage}, note ${noteLanguage}/${truth.expectedNoteLanguage}`,
    ),
  ];
}
