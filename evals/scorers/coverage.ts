import type { ExtranetClause, EvalScore, GroundTruth } from '@demo/shared';
import type { Observed } from '../lib/observed.js';

const score = (scorer: string, value: number | null, comment?: string): EvalScore => ({
  agent: 'coverage',
  scorer,
  value,
  ...(comment ? { comment } : {}),
});

/** Whitespace- and quote-insensitive form, to check that an excerpt is copied word for word. */
export function normalizeText(text: string): string {
  return text
    .replace(/[’‘]/g, "'")
    .replace(/[«»“”]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/[;.,:\s]+$/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Rule part of the citation check: every cited clause exists and the excerpt is a verbatim part of
 * it (so in its original language), and the clause that decides the verdict is among them.
 */
export function citationRule(
  citations: { ref: string; excerpt?: string | undefined }[],
  clauses: ReadonlyMap<string, ExtranetClause>,
  expectedRef: string | null,
): { value: number; comment: string } {
  if (citations.length === 0) return { value: 0, comment: 'no citation' };
  const problems: string[] = [];
  for (const citation of citations) {
    const clause = clauses.get(citation.ref);
    if (!clause) problems.push(`${citation.ref} does not exist`);
    else if (
      citation.excerpt &&
      !normalizeText(clause.text).includes(normalizeText(citation.excerpt))
    ) {
      problems.push(`${citation.ref}: excerpt not found in the clause`);
    }
  }
  if (expectedRef && !citations.some((citation) => citation.ref === expectedRef)) {
    problems.push(`${expectedRef} not cited`);
  }
  const valid = citations.length - problems.filter((p) => !p.endsWith('not cited')).length;
  const base = valid / citations.length;
  const value = expectedRef && problems.some((p) => p.endsWith('not cited')) ? base * 0.5 : base;
  return { value, comment: problems.join('; ') || 'ok' };
}

/** verdict, limit and deductible, alerts, citations (rule). */
export function scoreCoverage(
  truth: GroundTruth,
  observed: Observed,
  clauses: ReadonlyMap<string, ExtranetClause>,
): EvalScore[] {
  if (truth.scenario === 'non_claim') {
    return ['verdict', 'limit_deductible', 'alerts', 'citations'].map((name) => score(name, null));
  }
  const coverage = observed.coverage;
  if (!coverage) {
    return [
      score('verdict', 0, 'no coverage verdict'),
      score('limit_deductible', truth.scenario === 'unknown_client' ? null : 0),
      score('alerts', 0),
      score('citations', truth.scenario === 'unknown_client' ? null : 0),
    ];
  }
  const { params } = coverage;
  const expectedAlerts = new Set<string>(truth.alerts);
  const actualAlerts = new Set(Array.isArray(params.alerts) ? params.alerts : []);
  const union = new Set([...expectedAlerts, ...actualAlerts]);
  const intersection = [...expectedAlerts].filter((alert) => actualAlerts.has(alert));
  const alerts = union.size === 0 ? 1 : intersection.length / union.size;

  const scores = [
    score(
      'verdict',
      params.verdict === truth.verdict ? 1 : 0,
      `expected ${truth.verdict}, got ${String(params.verdict)}`,
    ),
    score(
      'alerts',
      alerts,
      `expected [${[...expectedAlerts].join(', ')}], got [${[...actualAlerts].join(', ')}]`,
    ),
  ];
  if (truth.scenario === 'unknown_client') {
    return [...scores, score('limit_deductible', null), score('citations', null)];
  }
  const numbers =
    (params.limit === truth.limit ? 0.5 : 0) + (params.deductible === truth.deductible ? 0.5 : 0);
  const rule = citationRule(coverage.citations, clauses, truth.clauseRef);
  return [
    ...scores,
    score(
      'limit_deductible',
      numbers,
      `limit ${String(params.limit)}/${truth.limit}, deductible ${String(params.deductible)}/${truth.deductible}`,
    ),
    score('citations', rule.value, rule.comment),
  ];
}
