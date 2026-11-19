import { Mastra } from '@mastra/core/mastra';
import { registerApiRoute } from '@mastra/core/server';
import { PostgresStore } from '@mastra/pg';
import { coverageAgent } from './agents/coverage.js';
import { draftingAgent } from './agents/drafting.js';
import { singleAgent } from './agents/single.js';
import { triageAgent } from './agents/triage.js';
import { env } from './env.js';
import { buildObservability } from './observability.js';
import { resilienceStats } from './resilience.js';
import { processEmailWorkflow } from './workflows/process-email.js';

export const mastra = new Mastra({
  agents: { triageAgent, coverageAgent, draftingAgent, singleAgent },
  workflows: { processEmailWorkflow },
  // Workflow snapshots and runs live in the `agents` database (tables created on first use): a run
  // suspended on `approval` survives a restart of the Mastra server.
  observability: buildObservability(),
  storage: new PostgresStore({ id: 'agents-storage', connectionString: env.AGENTS_DATABASE_URL }),
  server: {
    port: env.MASTRA_PORT,
    host: env.MASTRA_HOST,
    apiRoutes: [
      // Load tests (V9): MCP calls, retries and definitive failures of this instance.
      registerApiRoute('/resilience-stats', {
        method: 'GET',
        handler: (c) => c.json({ ...resilienceStats, pid: process.pid }),
      }),
    ],
  },
});
