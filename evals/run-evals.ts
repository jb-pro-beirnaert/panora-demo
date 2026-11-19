import {
  CaseDetailSchema,
  EvalReportSchema,
  type CaseDetail,
  type EvalCaseResult,
  type EvalReport,
  type ExtranetClause,
} from '@demo/shared';
import { toCoreSeed, toExtranetSeed } from '@demo/world-generator';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { DatasetSchema, languageOf, worldOf, type EvalCase } from './lib/dataset.js';
import { checkGate, type Thresholds } from './lib/gate.js';
import { langfuseFromEnv, pushScore, traceCost } from './lib/langfuse.js';
import { observe } from './lib/observed.js';
import { aggregate, toMarkdown, withWorkflowScore } from './lib/report.js';
import { scoreCoverage } from './scorers/coverage.js';
import { scoreDrafting } from './scorers/drafting.js';
import { judge } from './scorers/judge.js';
import { scoreTriage } from './scorers/triage.js';

/**
 * `npm run evals -- [--limit 5] [--no-judge] [--gate] [--baseline reports/baseline.json]`
 *
 * Runs the dataset through the real stack (`npm run dev` must be running): seeds Core and the MCP
 * extranet with the eval world (this replaces the demo data), sends each e-mail to Core, waits for
 * the first proposal, and scores what the agents produced against the ground truth.
 */
const { values } = parseArgs({
  options: {
    dataset: { type: 'string', default: 'datasets/seed-7.json' },
    limit: { type: 'string' },
    /** Only the cases whose e-mail is in this language (`fr` or `en`). */
    language: { type: 'string' },
    concurrency: { type: 'string', default: '3' },
    'no-judge': { type: 'boolean', default: false },
    'judge-model': { type: 'string', default: process.env.EVAL_JUDGE_MODEL ?? 'gpt-5-nano' },
    baseline: { type: 'string', default: 'reports/baseline.json' },
    gate: { type: 'boolean', default: false },
    'save-baseline': { type: 'boolean', default: false },
    'timeout-s': { type: 'string', default: '300' },
  },
});

const CORE = process.env.CORE_API_URL ?? 'http://localhost:3001';
const EXTRANET = process.env.MCP_EXTRANET_URL ?? 'http://localhost:3002';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';
const here = (path: string) => new URL(path, import.meta.url);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function post(base: string, path: string, body: unknown, admin = false): Promise<unknown> {
  const response = await fetch(new URL(path, base), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(admin ? { authorization: `Bearer ${ADMIN_TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

const DONE = new Set(['awaiting_approval', 'classified', 'ready_to_send', 'claim_filed', 'failed']);

async function waitForCase(caseId: string, timeoutMs: number): Promise<CaseDetail> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await fetch(new URL(`/cases/${caseId}`, CORE));
    const kase = CaseDetailSchema.parse(await response.json());
    if (DONE.has(kase.status) || Date.now() > deadline) return kase;
    await sleep(2_000);
  }
}

async function runCase(
  evalCase: EvalCase,
  clauses: ReadonlyMap<string, ExtranetClause>,
): Promise<EvalCaseResult & { latencyMs: number }> {
  const started = Date.now();
  const base = {
    id: evalCase.id,
    scenario: evalCase.groundTruth.scenario,
    language: languageOf(evalCase),
  };
  try {
    const { caseId } = (await post(CORE, '/emails', evalCase.email)) as { caseId: string };
    const kase = await waitForCase(caseId, Number(values['timeout-s']) * 1_000);
    const latencyMs = Date.now() - started;
    const error =
      kase.status === 'failed'
        ? `workflow failed: ${kase.failureReason ?? ''}`
        : DONE.has(kase.status)
          ? null
          : `timeout (status ${kase.status})`;
    const observed = observe(kase);
    const truth = evalCase.groundTruth;
    const scores = [
      ...scoreTriage(truth, observed),
      ...scoreCoverage(truth, observed, clauses),
      ...scoreDrafting(truth, observed),
    ];
    if (!values['no-judge'] && process.env.OPENAI_API_KEY) {
      scores.push(
        ...(await judge(truth, observed, clauses, {
          apiKey: process.env.OPENAI_API_KEY,
          model: values['judge-model'],
        })),
      );
    }
    console.log(`${evalCase.id} ${base.scenario}/${base.language}: ${kase.status}`);
    return {
      ...base,
      caseId,
      traceId: kase.traceId,
      error,
      scores: withWorkflowScore(scores, error),
      latencyMs,
    };
  } catch (failure) {
    const error = String(failure);
    console.error(`${evalCase.id}: ${error}`);
    return {
      ...base,
      caseId: null,
      traceId: null,
      error,
      scores: withWorkflowScore([], error),
      latencyMs: Date.now() - started,
    };
  }
}

/** Runs `tasks` with at most `limit` in flight. */
async function pool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await task(items[index]!);
      }
    }),
  );
  return results;
}

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;

async function main(): Promise<void> {
  const dataset = DatasetSchema.parse(JSON.parse(readFileSync(here(values.dataset), 'utf8')));
  const inLanguage = values.language
    ? dataset.cases.filter((c) => languageOf(c) === values.language)
    : dataset.cases;
  const cases = values.limit ? inLanguage.slice(0, Number(values.limit)) : inLanguage;
  const world = worldOf(dataset);
  const clauses = new Map(world.clauses.map((clause) => [clause.ref, clause]));
  const startedAt = new Date().toISOString();
  console.log(`seeding the eval world (seed ${dataset.seed}) and running ${cases.length} cases…`);
  await post(EXTRANET, '/admin/seed', toExtranetSeed(world), true);
  await post(CORE, '/admin/seed', toCoreSeed(world), true);

  const results = await pool(cases, Number(values.concurrency), (c) => runCase(c, clauses));

  // Traces are exported asynchronously: give Langfuse a moment before reading costs.
  const langfuse = langfuseFromEnv();
  let costPerCaseUsd: number | null = null;
  if (langfuse) {
    await sleep(10_000);
    const costs: number[] = [];
    for (const result of results) {
      if (!result.traceId) continue;
      for (const score of result.scores) {
        if (score.value === null) continue;
        await pushScore(langfuse, {
          traceId: result.traceId,
          name: `${score.agent}/${score.scorer}`,
          value: score.value,
          comment: score.comment,
        });
      }
      const cost = await traceCost(langfuse, result.traceId);
      if (cost !== null) costs.push(cost);
    }
    if (costs.length) costPerCaseUsd = costs.reduce((a, b) => a + b, 0) / costs.length;
  }

  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const report: EvalReport = EvalReportSchema.parse({
    runId: startedAt.replace(/[:.]/g, '-'),
    startedAt,
    finishedAt: new Date().toISOString(),
    dataset: { name: dataset.name, seed: dataset.seed, size: cases.length },
    models: {
      triage: process.env.TRIAGE_MODEL ?? 'openai/gpt-5-nano',
      coverage: process.env.COVERAGE_MODEL ?? 'openai/gpt-6-luna',
      drafting: process.env.DRAFTING_MODEL ?? 'openai/gpt-6-luna',
    },
    judge: values['no-judge'] || !process.env.OPENAI_API_KEY ? null : values['judge-model'],
    aggregates: aggregate(results),
    cases: results.map(({ latencyMs: _latency, ...result }) => result),
    costPerCaseUsd,
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
  });

  const reports = here('./reports/');
  mkdirSync(reports, { recursive: true });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(new URL(`${report.runId}.json`, reports), json);
  writeFileSync(new URL('latest.json', reports), json);
  const langfuseUrl = process.env.NEXT_PUBLIC_LANGFUSE_URL ?? langfuse?.baseUrl ?? '';
  writeFileSync(
    new URL('latest.md', reports),
    toMarkdown(report, (traceId) => `${langfuseUrl}/trace/${traceId}`),
  );
  if (values['save-baseline']) writeFileSync(new URL('baseline.json', reports), json);
  console.log(toMarkdown(report, (traceId) => `${langfuseUrl}/trace/${traceId}`));

  if (values.gate) {
    const thresholds = JSON.parse(readFileSync(here('thresholds.json'), 'utf8')) as Thresholds;
    const baselinePath = here(values.baseline);
    const baseline = existsSync(baselinePath)
      ? EvalReportSchema.parse(JSON.parse(readFileSync(baselinePath, 'utf8')))
      : null;
    const failures = checkGate(report, thresholds, baseline);
    if (failures.length > 0) {
      console.error('Eval gate FAILED:');
      for (const failure of failures) console.error(`- ${failure.key}: ${failure.reason}`);
      process.exitCode = 1;
    } else {
      console.log('Eval gate passed.');
    }
  }
}

await main();
