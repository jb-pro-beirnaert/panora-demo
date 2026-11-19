import { RunOptionsSchema, type EvalReport, type RunOptions } from '@demo/shared';
import { z } from 'zod';

export const MatrixConfigSchema = z.object({
  name: z.string(),
  group: z.enum(['baseline', 'triage', 'coverage', 'drafting', 'architecture', 'optimisation']),
  /** `ollama`: only with `--with-ollama` (needs `docker compose --profile ollama` and a pulled model). */
  requires: z.literal('ollama').optional(),
  runOptions: RunOptionsSchema,
});
export type MatrixConfig = z.infer<typeof MatrixConfigSchema>;

export const MatrixFileSchema = z.object({
  description: z.string().optional(),
  configs: z.array(MatrixConfigSchema),
});

export interface MatrixRow {
  config: MatrixConfig;
  models: Record<'triage' | 'coverage' | 'drafting', string>;
  report: EvalReport;
}

/** Mean of an agent's scorers (strict ones and judges alike), or of the whole-case score. */
export function agentScore(
  report: EvalReport,
  agent: string,
  language?: 'fr' | 'en',
): number | null {
  const values = report.aggregates
    .filter((a) => a.agent === agent)
    .map((a) => (language ? a.byLanguage[language] : a.mean))
    .filter((value): value is number => value !== null && value !== undefined);
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

export function effectiveModels(
  runOptions: RunOptions,
  defaults: Record<'triage' | 'coverage' | 'drafting', string>,
): Record<'triage' | 'coverage' | 'drafting', string> {
  return { ...defaults, ...(runOptions.models ?? {}) } as Record<
    'triage' | 'coverage' | 'drafting',
    string
  >;
}

const pct = (value: number | null) => (value === null ? '—' : (value * 100).toFixed(1));
const usd = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `$${value.toFixed(4)}`;
const seconds = (ms: number | undefined) =>
  ms === undefined ? '—' : `${(ms / 1000).toFixed(0)} s`;

/** The comparison table of the README: one row per configuration. */
export function matrixMarkdown(rows: MatrixRow[], sampleSize: number): string {
  const agentFor = (row: MatrixRow) =>
    ['triage', 'coverage', 'drafting'].includes(row.config.group) ? row.config.group : 'workflow';
  const lines = [
    `| Configuration | Agent | Model | Agent score | FR | EN | Cases correct | Cost / case | Latency p50 / p95 |`,
    `| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |`,
  ];
  for (const row of rows) {
    const agent = agentFor(row);
    const model =
      row.config.runOptions.architecture === 'single_agent'
        ? `${row.models.coverage} (one agent)`
        : agent === 'workflow'
          ? `${row.models.triage} / ${row.models.coverage} / ${row.models.drafting}`
          : row.models[agent as 'triage'];
    lines.push(
      `| ${row.config.name} | ${agent} | \`${model}\` | ${pct(agentScore(row.report, agent))} | ${pct(agentScore(row.report, agent, 'fr'))} | ${pct(agentScore(row.report, agent, 'en'))} | ${pct(agentScore(row.report, 'workflow'))} | ${usd(row.report.costPerCaseUsd)} | ${seconds(row.report.latencyMs?.p50)} / ${seconds(row.report.latencyMs?.p95)} |`,
    );
  }
  return `Sample: ${sampleSize} cases per configuration (same cases for every row).\n\n${lines.join('\n')}\n`;
}
