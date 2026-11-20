import {
  CaseDetailSchema,
  EvalReportSchema,
  type CaseDetail,
  type EvalCaseResult,
  type EvalReport,
  type ExtranetClause,
  type RunOptions,
} from '@demo/shared';
import { toRawEmail } from '@demo/documents';
import { toCoreSeed, toExtranetSeed } from '@demo/world-generator';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { DatasetSchema, languageOf, worldOf, type EvalCase } from './lib/dataset.js';
import { checkGate, type Thresholds } from './lib/gate.js';
import { langfuseFromEnv, pushScore, traceCost, type LangfuseConfig } from './lib/langfuse.js';
import {
  effectiveModels,
  MatrixFileSchema,
  matrixMarkdown,
  type MatrixConfig,
  type MatrixRow,
} from './lib/matrix.js';
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
    /** Compare the configurations of matrix.json on a sample (V8). */
    matrix: { type: 'boolean', default: false },
    /** Matrix sample size: two thirds French, one third English cases. */
    sample: { type: 'string', default: '6' },
    'with-ollama': { type: 'boolean', default: false },
    /** Only the matrix configurations whose name contains this text. */
    only: { type: 'string' },
  },
});

const CORE = process.env.CORE_API_URL ?? 'http://localhost:3001';
const EXTRANET = process.env.MCP_EXTRANET_URL ?? 'http://localhost:3002';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';
const here = (path: string) => new URL(path, import.meta.url);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const INBOUND_TOKEN = process.env.INBOUND_EMAIL_TOKEN ?? '';

async function post(base: string, path: string, body: unknown, admin = false): Promise<unknown> {
  const response = await fetch(new URL(path, base), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Admin routes: the admin token; `POST /emails`: the inbound gateway token (V10).
      authorization: `Bearer ${admin ? ADMIN_TOKEN : INBOUND_TOKEN}`,
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
    const response = await fetch(new URL(`/cases/${caseId}`, CORE), {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const kase = CaseDetailSchema.parse(await response.json());
    if (DONE.has(kase.status) || Date.now() > deadline) return kase;
    await sleep(2_000);
  }
}

interface RunConfig {
  runOptions?: RunOptions;
  /** Suffix of the message ids, so the same e-mail can run once per configuration. */
  tag?: string;
  judge: boolean;
}

async function runCase(
  evalCase: EvalCase,
  clauses: ReadonlyMap<string, ExtranetClause>,
  config: RunConfig,
): Promise<EvalCaseResult & { latencyMs: number }> {
  const started = Date.now();
  const base = {
    id: evalCase.id,
    scenario: evalCase.groundTruth.scenario,
    language: languageOf(evalCase),
  };
  try {
    const email = config.tag
      ? { ...evalCase.email, messageId: evalCase.email.messageId.replace('@', `.${config.tag}@`) }
      : evalCase.email;
    // V14: the e-mail goes to Core with real PDFs, so the agents get the text Core extracts from
    // them, exactly as in the demo.
    const { caseId } = (await post(CORE, '/emails', {
      ...(await toRawEmail(email)),
      ...(config.runOptions && Object.keys(config.runOptions).length
        ? { runOptions: config.runOptions }
        : {}),
    })) as { caseId: string };
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
    if (config.judge && process.env.OPENAI_API_KEY) {
      scores.push(
        ...(await judge(truth, observed, clauses, {
          apiKey: process.env.OPENAI_API_KEY,
          model: values['judge-model'],
        })),
      );
    }
    console.log(
      `${evalCase.id}${config.tag ? ` [${config.tag}]` : ''} ${base.scenario}/${base.language}: ${kase.status}`,
    );
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

const DEFAULT_MODELS = {
  triage: process.env.TRIAGE_MODEL ?? 'openai/gpt-5-nano',
  coverage: process.env.COVERAGE_MODEL ?? 'openai/gpt-6-luna',
  drafting: process.env.DRAFTING_MODEL ?? 'openai/gpt-6-luna',
};

/** Pushes the scores to Langfuse and reads the average cost per case from the traces. */
async function finishWithLangfuse(
  langfuse: LangfuseConfig | null,
  results: EvalCaseResult[],
): Promise<number | null> {
  if (!langfuse) return null;
  // Traces are exported asynchronously: give Langfuse a moment before reading costs.
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
  return costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
}

function buildReport(
  datasetInfo: { name: string; seed: number },
  startedAt: string,
  results: (EvalCaseResult & { latencyMs: number })[],
  models: Record<string, string>,
  judgeModel: string | null,
  costPerCaseUsd: number | null,
): EvalReport {
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  return EvalReportSchema.parse({
    runId: startedAt.replace(/[:.]/g, '-'),
    startedAt,
    finishedAt: new Date().toISOString(),
    dataset: { ...datasetInfo, size: results.length },
    models,
    judge: judgeModel,
    aggregates: aggregate(results),
    cases: results.map(({ latencyMs: _latency, ...result }) => result),
    costPerCaseUsd,
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
  });
}

/** Two thirds French, one third English: both languages appear even in a small sample. */
function sampleCases(cases: EvalCase[], size: number): EvalCase[] {
  const english = Math.max(1, Math.round(size / 3));
  return [
    ...cases.filter((c) => languageOf(c) === 'fr').slice(0, size - english),
    ...cases.filter((c) => languageOf(c) === 'en').slice(0, english),
  ];
}

async function runMatrix(
  dataset: { name: string; seed: number },
  cases: EvalCase[],
  clauses: ReadonlyMap<string, ExtranetClause>,
  langfuse: LangfuseConfig | null,
): Promise<void> {
  const file = MatrixFileSchema.parse(JSON.parse(readFileSync(here('matrix.json'), 'utf8')));
  const configs: MatrixConfig[] = file.configs.filter(
    (config) =>
      (!config.requires || values['with-ollama']) &&
      (!values.only || config.name.includes(values.only)),
  );
  const sample = sampleCases(cases, Number(values.sample));
  const startedAt = new Date().toISOString();
  console.log(`matrix: ${configs.length} configurations × ${sample.length} cases`);
  const tasks = configs.flatMap((config, index) =>
    sample.map((evalCase) => ({ config, index, evalCase })),
  );
  const results = await pool(tasks, Number(values.concurrency), ({ config, index, evalCase }) =>
    runCase(evalCase, clauses, {
      runOptions: config.runOptions,
      tag: `m${index}`,
      judge: !values['no-judge'],
    }),
  );
  const rows: MatrixRow[] = [];
  for (const [index, config] of configs.entries()) {
    const own = results.filter((_, i) => tasks[i]!.index === index);
    const models = effectiveModels(config.runOptions, DEFAULT_MODELS);
    const cost = await finishWithLangfuse(langfuse, own);
    rows.push({
      config,
      models,
      report: buildReport(
        dataset,
        startedAt,
        own,
        models,
        values['no-judge'] ? null : values['judge-model'],
        cost,
      ),
    });
  }
  const reports = here('./reports/');
  mkdirSync(reports, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, '-');
  writeFileSync(
    new URL(`matrix-${stamp}.json`, reports),
    `${JSON.stringify({ startedAt, sample: sample.map((c) => c.id), rows }, null, 2)}\n`,
  );
  const markdown = matrixMarkdown(rows, sample.length);
  writeFileSync(new URL('matrix-latest.md', reports), markdown);
  console.log(markdown);
}

async function main(): Promise<void> {
  const dataset = DatasetSchema.parse(JSON.parse(readFileSync(here(values.dataset), 'utf8')));
  const inLanguage = values.language
    ? dataset.cases.filter((c) => languageOf(c) === values.language)
    : dataset.cases;
  const cases = values.limit ? inLanguage.slice(0, Number(values.limit)) : inLanguage;
  const world = worldOf(dataset);
  const clauses = new Map(world.clauses.map((clause) => [clause.ref, clause]));
  const langfuse = langfuseFromEnv();
  const startedAt = new Date().toISOString();
  console.log(`seeding the eval world (seed ${dataset.seed})…`);
  await post(EXTRANET, '/admin/seed', toExtranetSeed(world), true);
  await post(CORE, '/admin/seed', toCoreSeed(world), true);

  const info = { name: dataset.name, seed: dataset.seed };
  if (values.matrix) {
    await runMatrix(info, inLanguage, clauses, langfuse);
    return;
  }
  console.log(`running ${cases.length} cases…`);
  const judgeOn = !values['no-judge'] && Boolean(process.env.OPENAI_API_KEY);
  const results = await pool(cases, Number(values.concurrency), (c) =>
    runCase(c, clauses, { judge: judgeOn }),
  );
  const costPerCaseUsd = await finishWithLangfuse(langfuse, results);
  const report = buildReport(
    info,
    startedAt,
    results,
    DEFAULT_MODELS,
    judgeOn ? values['judge-model'] : null,
    costPerCaseUsd,
  );

  const reports = here('./reports/');
  mkdirSync(reports, { recursive: true });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(new URL(`${report.runId}.json`, reports), json);
  writeFileSync(new URL('latest.json', reports), json);
  const langfuseUrl = process.env.NEXT_PUBLIC_LANGFUSE_URL ?? langfuse?.baseUrl ?? '';
  const projectId = process.env.NEXT_PUBLIC_LANGFUSE_PROJECT_ID;
  const markdown = toMarkdown(report, (traceId) =>
    projectId
      ? `${langfuseUrl}/project/${projectId}/traces/${traceId}`
      : `${langfuseUrl}/trace/${traceId}`,
  );
  writeFileSync(new URL('latest.md', reports), markdown);
  if (values['save-baseline']) writeFileSync(new URL('baseline.json', reports), json);
  console.log(markdown);

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
