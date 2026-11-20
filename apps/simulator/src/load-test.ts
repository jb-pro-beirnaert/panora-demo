import { toRawEmail } from '@demo/documents';
import { CaseMetricsSchema, type CaseMetrics, type RawEmailInput } from '@demo/shared';
import { generateEmails, generateWorld } from '@demo/world-generator';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { AutoValidator } from './auto-validation/auto-validator.js';
import { loadEnv } from './env.js';
import { resetAll } from './seeding/seeder.js';
import { Burst } from './stream/burst.js';

/**
 * `npm run load-test -w apps/simulator -- --count 1000`
 *
 * Resets the demo, starts a simulated broker (immediate decisions, no rejection), sends a burst
 * of generated e-mails to Core, then follows Core's metrics until every case is closed or failed
 * (or the timeout). Writes the measures to docs/load-tests/. Run it against
 * `AGENTS_MODE=simulated` unless you want to pay for the LLM calls. Since V14 the load test is
 * self-contained: the demo simulator only plays the demo script.
 */
const { values } = parseArgs({
  options: {
    count: { type: 'string', default: '1000' },
    concurrency: { type: 'string', default: '20' },
    'timeout-min': { type: 'string', default: '60' },
    label: { type: 'string', default: 'burst' },
  },
});
const env = loadEnv();
const CORE = env.CORE_API_URL;
const MCP = env.MCP_EXTRANET_URL;
const MASTRA = (process.env.MASTRA_URL ?? 'http://localhost:4111').split(',');
const count = Number(values.count);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function json(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      // Core's metrics and Mastra's stats need the demo admin / service tokens (V10).
      ...(url.startsWith(CORE) && process.env.ADMIN_TOKEN
        ? { authorization: `Bearer ${process.env.ADMIN_TOKEN}` }
        : {}),
      ...(MASTRA.some((m) => url.startsWith(m)) && process.env.MASTRA_API_TOKEN
        ? { authorization: `Bearer ${process.env.MASTRA_API_TOKEN}` }
        : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function deliver(email: RawEmailInput): Promise<void> {
  const response = await fetch(new URL('/emails', CORE), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.INBOUND_EMAIL_TOKEN}`,
    },
    body: JSON.stringify(email),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`POST /emails failed (${response.status})`);
}

async function mastraStats() {
  const stats = { toolCalls: 0, retries: 0, failures: 0, instances: 0 };
  for (const url of MASTRA) {
    try {
      const s = (await json(`${url}/resilience-stats`)) as typeof stats;
      stats.toolCalls += s.toolCalls;
      stats.retries += s.retries;
      stats.failures += s.failures;
      stats.instances += 1;
    } catch {
      // instance down (the test may stop one on purpose)
    }
  }
  return stats;
}

const world = generateWorld({
  seed: env.WORLD_SEED,
  locales: ['fr', 'en'],
  mix: { en: env.SIMULATOR_ENGLISH_SHARE },
});
// A pool of distinct e-mails (with their PDFs), cycled over by the burst with unique message ids.
const pool = await Promise.all(
  generateEmails(world, { seed: env.WORLD_SEED, count: Math.min(count, 200) }).map(({ email }) =>
    toRawEmail(email),
  ),
);
await resetAll(world, {
  coreUrl: CORE,
  extranetUrl: MCP,
  adminToken: env.ADMIN_TOKEN,
});
const broker = new AutoValidator(CORE, env.ADMIN_TOKEN);
broker.update({ enabled: true, delayMs: 0, rejectionRate: 0 });
broker.listen();
const burst = new Burst(pool, deliver);
const before = await mastraStats();
const started = Date.now();
burst.start(count, Number(values.concurrency));
console.log(`burst of ${count} e-mails started`);

const deadline = started + Number(values['timeout-min']) * 60_000;
let metrics: CaseMetrics;
for (;;) {
  metrics = CaseMetricsSchema.parse(await json(`${CORE}/cases/metrics`));
  const closed =
    (metrics.byStatus.classified ?? 0) +
    (metrics.byStatus.claim_filed ?? 0) +
    (metrics.byStatus.ready_to_send ?? 0);
  const failed = metrics.byStatus.failed ?? 0;
  const elapsed = Math.round((Date.now() - started) / 1_000);
  console.log(
    `${elapsed}s total ${metrics.total} closed ${closed} failed ${failed} last-minute ${metrics.closedLastMinute} queue ${metrics.queues['process-email']?.waiting ?? 0}/${metrics.queues['resume-workflow']?.waiting ?? 0} restarts ${metrics.restarts}`,
  );
  if ((metrics.total >= count && closed + failed >= metrics.total) || Date.now() > deadline) break;
  await sleep(10_000);
}
const durationMin = (Date.now() - started) / 60_000;
const after = await mastraStats();
const chaos = ((await json(`${MCP}/health`)) as { chaos: unknown }).chaos;
const closed =
  (metrics.byStatus.classified ?? 0) +
  (metrics.byStatus.claim_filed ?? 0) +
  (metrics.byStatus.ready_to_send ?? 0);
const toolCalls = after.toolCalls - before.toolCalls;
const result = {
  label: values.label,
  at: new Date().toISOString(),
  requested: count,
  burst: burst.state,
  decisions: broker.decisions,
  casesCreated: metrics.total,
  closed,
  failed: metrics.byStatus.failed ?? 0,
  stillOpen: metrics.total - closed - (metrics.byStatus.failed ?? 0),
  durationMin: Number(durationMin.toFixed(2)),
  throughputPerMin: Number((closed / durationMin).toFixed(1)),
  caseDurationMs: metrics.durationMs,
  workflowRestarts: metrics.restarts,
  mcp: {
    toolCalls,
    retries: after.retries - before.retries,
    definitiveFailures: after.failures - before.failures,
    retryRate: toolCalls ? Number(((after.retries - before.retries) / toolCalls).toFixed(4)) : 0,
  },
  definitiveFailureRate: metrics.total
    ? Number(((metrics.byStatus.failed ?? 0) / metrics.total).toFixed(4))
    : 0,
  chaos,
};
console.log(JSON.stringify(result, null, 2));
const directory = new URL('../../../docs/load-tests/', import.meta.url);
mkdirSync(directory, { recursive: true });
writeFileSync(
  new URL(`${values.label}-${result.at.replace(/[:.]/g, '-')}.json`, directory),
  `${JSON.stringify(result, null, 2)}\n`,
);
// The simulated broker keeps its realtime connection open: stop explicitly.
process.exit(0);
