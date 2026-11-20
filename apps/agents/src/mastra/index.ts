import { Mastra } from '@mastra/core/mastra';
import { registerApiRoute } from '@mastra/core/server';
import { PostgresStore } from '@mastra/pg';
import { coverageAgent } from './agents/coverage.js';
import { draftingAgent } from './agents/drafting.js';
import { policyServiceAgent } from './agents/policy-service.js';
import { singleAgent } from './agents/single.js';
import { triageAgent } from './agents/triage.js';
import { env } from './env.js';
import { buildObservability } from './observability.js';
import { resilienceStats } from './resilience.js';
import { purge, PurgeRequestSchema, workflowsStore } from './retention.js';
import { requireServiceToken } from './security.js';
import { draftReplyWorkflow } from './workflows/draft-reply.js';
import { processEmailWorkflow } from './workflows/process-email.js';

export const mastra = new Mastra({
  agents: { triageAgent, coverageAgent, policyServiceAgent, draftingAgent, singleAgent },
  workflows: { processEmailWorkflow, draftReplyWorkflow },
  // Workflow snapshots and runs live in the `agents` database (tables created on first use): a run
  // suspended on `approval` survives a restart of the Mastra server.
  observability: buildObservability(),
  storage: new PostgresStore({ id: 'agents-storage', connectionString: env.AGENTS_DATABASE_URL }),
  server: {
    port: env.MASTRA_PORT,
    host: env.MASTRA_HOST,
    middleware: [
      { path: '/api/*', handler: requireServiceToken },
      { path: '/maintenance/*', handler: requireServiceToken },
      { path: '/resilience-stats', handler: requireServiceToken },
    ],
    apiRoutes: [
      // Retention (V10): called by Core's purge job.
      registerApiRoute('/maintenance/purge', {
        method: 'POST',
        handler: async (c) => {
          const parsed = PurgeRequestSchema.safeParse(await c.req.json());
          if (!parsed.success) return c.json({ error: 'invalid purge request' }, 400);
          const mastra = c.get('mastra');
          return c.json(await purge(await workflowsStore(mastra), parsed.data));
        },
      }),
      // Load tests (V9): MCP calls, retries and definitive failures of this instance.
      registerApiRoute('/resilience-stats', {
        method: 'GET',
        handler: (c) => c.json({ ...resilienceStats, pid: process.pid }),
      }),
    ],
  },
});
