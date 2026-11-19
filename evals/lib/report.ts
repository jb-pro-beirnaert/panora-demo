import type { EvalAggregate, EvalCaseResult, EvalReport, EvalScore, Locale } from '@demo/shared';

const LOCALES: Locale[] = ['fr', 'en'];

/** Binary checks that must all pass for a case to be "entirely correct". */
const STRICT = new Set([
  'triage/request_type',
  'coverage/verdict',
  'drafting/action_type',
  'drafting/amounts',
]);

/** Adds the workflow score: 1 when every applicable strict check passes. */
export function withWorkflowScore(scores: EvalScore[], error: string | null): EvalScore[] {
  const strict = scores.filter(
    (score) => STRICT.has(`${score.agent}/${score.scorer}`) && score.value !== null,
  );
  const failed = strict.filter((score) => score.value !== 1).map((s) => `${s.agent}/${s.scorer}`);
  return [
    ...scores,
    {
      agent: 'workflow',
      scorer: 'case_correct',
      value: error ? 0 : failed.length === 0 ? 1 : 0,
      comment: error ?? (failed.length ? `failed: ${failed.join(', ')}` : 'ok'),
    },
  ];
}

const mean = (values: number[]) =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

export function aggregate(cases: EvalCaseResult[]): EvalAggregate[] {
  const keys = new Map<string, { agent: EvalAggregate['agent']; scorer: string }>();
  for (const result of cases) {
    for (const score of result.scores) {
      keys.set(`${score.agent}/${score.scorer}`, { agent: score.agent, scorer: score.scorer });
    }
  }
  const valuesOf = (key: string, language?: Locale) =>
    cases
      .filter((result) => !language || result.language === language)
      .flatMap((result) =>
        result.scores
          .filter((s) => `${s.agent}/${s.scorer}` === key && s.value !== null)
          .map((s) => s.value as number),
      );
  return [...keys.entries()].map(([key, { agent, scorer }]) => {
    const all = valuesOf(key);
    return {
      agent,
      scorer,
      mean: mean(all),
      count: all.length,
      byLanguage: Object.fromEntries(
        LOCALES.map((language) => [language, mean(valuesOf(key, language))]),
      ) as Record<Locale, number | null>,
    };
  });
}

const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}`;

export function toMarkdown(report: EvalReport, traceUrl: (traceId: string) => string): string {
  const lines = [
    `# Eval report — ${report.dataset.name} (${report.dataset.size} cases)`,
    '',
    `Run \`${report.runId}\`, ${report.startedAt} → ${report.finishedAt}. Models: ${Object.entries(
      report.models,
    )
      .map(([agent, model]) => `${agent} \`${model}\``)
      .join(', ')}. Judge: ${report.judge ? `\`${report.judge}\`` : 'off'}.`,
    '',
    '| Agent | Scorer | Score | FR | EN | Cases |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...report.aggregates.map(
      (a) =>
        `| ${a.agent} | ${a.scorer} | ${percent(a.mean)} | ${percent(a.byLanguage.fr)} | ${percent(a.byLanguage.en)} | ${a.count} |`,
    ),
  ];
  if (report.costPerCaseUsd !== undefined && report.costPerCaseUsd !== null) {
    lines.push('', `Average cost per case: $${report.costPerCaseUsd.toFixed(4)}.`);
  }
  if (report.latencyMs) {
    lines.push(`Latency per case: p50 ${report.latencyMs.p50} ms, p95 ${report.latencyMs.p95} ms.`);
  }
  const failing = report.cases.filter((result) =>
    result.scores.some((score) => score.agent === 'workflow' && score.value === 0),
  );
  lines.push('', `## Failing cases (${failing.length})`, '');
  for (const result of failing) {
    const reason =
      result.scores.find((score) => score.agent === 'workflow')?.comment ?? result.error ?? '';
    const trace = result.traceId ? ` — [trace](${traceUrl(result.traceId)})` : '';
    lines.push(`- \`${result.id}\` (${result.scenario}, ${result.language}): ${reason}${trace}`);
  }
  return `${lines.join('\n')}\n`;
}
