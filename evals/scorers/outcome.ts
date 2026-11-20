import type { EvalScore, GroundTruth } from '@demo/shared';
import type { Observed } from '../lib/observed.js';

const score = (scorer: string, value: number | null, comment?: string): EvalScore => ({
  agent: 'workflow',
  scorer,
  value,
  ...(comment ? { comment } : {}),
});

/** Where the e-mail ended up, read from the case status (V15). */
function outcomeOf(observed: Observed): 'action' | 'needs_broker' | 'classified' | 'other' {
  if (observed.status === 'needs_broker') return 'needs_broker';
  if (observed.status === 'classified') return 'classified';
  if (observed.status === 'awaiting_approval' && observed.proposal) return 'action';
  return 'other';
}

/**
 * V15, requests that are not claims: the outcome (proposal, "À traiter par vous" or classified),
 * the hand-over reason, and the effective date of a cancellation. Null for claims.
 */
export function scoreOutcome(truth: GroundTruth, observed: Observed): EvalScore[] {
  if (truth.requestType === 'claim') {
    return [score('outcome', null), score('handover_reason', null), score('effective_date', null)];
  }
  const outcome = outcomeOf(observed);
  const scores = [
    score(
      'outcome',
      outcome === truth.expectedOutcome ? 1 : 0,
      `expected ${truth.expectedOutcome}, got ${outcome} (status ${observed.status})`,
    ),
    score(
      'handover_reason',
      truth.handoverReason === null
        ? null
        : observed.handoverReason === truth.handoverReason
          ? 1
          : 0,
      `expected ${String(truth.handoverReason)}, got ${String(observed.handoverReason)}`,
    ),
  ];
  const effective = observed.service?.effectiveDate ?? null;
  scores.push(
    score(
      'effective_date',
      truth.requestType !== 'cancellation' ? null : effective === truth.effectiveDate ? 1 : 0,
      `expected ${String(truth.effectiveDate)}, got ${String(effective)}`,
    ),
  );
  return scores;
}
