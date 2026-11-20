import type { EvalScore, GroundTruth } from '@demo/shared';
import type { Observed } from '../lib/observed.js';

const score = (scorer: string, value: number | null, comment?: string): EvalScore => ({
  agent: 'triage',
  scorer,
  value,
  ...(comment ? { comment } : {}),
});

/** requestType, every extracted field, emailLanguage. */
export function scoreTriage(truth: GroundTruth, observed: Observed): EvalScore[] {
  const triage = observed.triage;
  if (!triage) {
    return [
      score('request_type', 0, 'no triage step'),
      score('fields', truth.requestType === 'claim' ? 0 : null),
      score('email_language', 0, 'no triage step'),
    ];
  }
  // V15: for information and unrelated e-mails, the subtype must match too.
  const expectedSubtype = truth.requestType === 'claim' ? null : truth.subtype;
  const typeOk =
    triage.requestType === truth.requestType &&
    (expectedSubtype === null || triage.subtype === expectedSubtype);
  const scores = [
    score(
      'request_type',
      typeOk ? 1 : 0,
      `expected ${truth.requestType}${expectedSubtype ? `/${expectedSubtype}` : ''}, got ${String(triage.requestType)}${triage.subtype ? `/${String(triage.subtype)}` : ''}`,
    ),
    score(
      'email_language',
      triage.emailLanguage === truth.emailLanguage ? 1 : 0,
      `expected ${truth.emailLanguage}, got ${String(triage.emailLanguage)}`,
    ),
  ];
  if (truth.requestType !== 'claim') return [...scores, score('fields', null)];

  // Expected extraction: a value only when it can be read in the e-mail.
  const checks: [string, unknown, unknown][] = [
    ['nature', truth.nature, triage.nature],
    ['amount', truth.amount, triage.amount],
  ];
  if (truth.scenario !== 'unknown_client') {
    checks.push(
      ['policyNumber', truth.policyNumberInEmail ? truth.policyNumber : null, triage.policyNumber],
      ['incidentDate', truth.incidentDateReadable ? truth.incidentDate : null, triage.incidentDate],
    );
  }
  const wrong = checks.filter(([, expected, actual]) => (expected ?? null) !== (actual ?? null));
  return [
    ...scores,
    score(
      'fields',
      (checks.length - wrong.length) / checks.length,
      wrong.map(([name, e, a]) => `${name}: expected ${String(e)}, got ${String(a)}`).join('; '),
    ),
  ];
}
