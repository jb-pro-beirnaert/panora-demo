import { CaseMetricsSchema, type CaseMetrics } from '@demo/shared';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

/**
 * `npm run load-test -w apps/simulator -- --count 1000`
 *
 * Resets the demo, turns the simulated broker on (immediate decisions, no rejection), sends a
 * burst, then follows Core's metrics until every case is closed or failed (or the timeout). Writes
 * the measures to docs/load-tests/. Run it against `AGENTS_MODE=simulated` unless you want to pay
 * for the LLM calls.
 */
const { values } = parseArgs({
  options: {
    count: { type: 'string', default: '1000' },
    concurrency: { type: 'string', default: '20' },
    'timeout-min': { type: 'string', default: '60' },
    label: { type: 'string', default: 'burst' },
  },
});
const SIMULATOR = process.env.SIMULATOR_URL ?? 'http://localhost:3003';
const CORE = process.env.CORE_API_URL ?? 'http://localhost:3001';
const MCP = process.env.MCP_EXTRANET_URL ?? 'http://localhost:3002';
const MASTRA = (process.env.MASTRA_URL ?? 'http://localhost:4111').split(',');
const count = Number(values.count);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function json(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`);
  return response.json();
}

const post = (path: string, body?: unknown) =>
  json(`${SIMULATOR}${path}`, { method: 'POST', body: JSON.stringify(body ?? {}) });

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

await post('/reset');
await post('/auto-validation', { enabled: true, delayMs: 0, rejectionRate: 0 });
const before = await mastraStats();
const started = Date.now();
await post('/burst', { count, concurrency: Number(values.concurrency) });
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
const simulator = (await json(`${SIMULATOR}/state`)) as { burst: unknown };
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
  burst: simulator.burst,
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
