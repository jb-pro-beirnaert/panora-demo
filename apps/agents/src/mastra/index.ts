import { Mastra } from '@mastra/core/mastra';
import { PostgresStore } from '@mastra/pg';
import { coverageAgent } from './agents/coverage.js';
import { triageAgent } from './agents/triage.js';
import { env } from './env.js';
import { processEmailWorkflow } from './workflows/process-email.js';

export const mastra = new Mastra({
  agents: { triageAgent, coverageAgent },
  workflows: { processEmailWorkflow },
  // Workflow snapshots and runs live in the `agents` database (tables created on first use).
  storage: new PostgresStore({ id: 'agents-storage', connectionString: env.AGENTS_DATABASE_URL }),
  server: {
    port: env.MASTRA_PORT,
    host: env.MASTRA_HOST,
  },
});
