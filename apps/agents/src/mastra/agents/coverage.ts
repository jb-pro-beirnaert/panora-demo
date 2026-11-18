import { Agent } from '@mastra/core/agent';
import { env } from '../env.js';
import { extranetReadTools } from '../mcp/extranet-client.js';
import { coverageInstructions } from '../prompts/coverage.js';

export const coverageAgent = new Agent({
  id: 'coverage-agent',
  name: 'Coverage agent',
  description:
    "Checks a claim against the insurer's extranet (read-only MCP tools) and returns a sourced CoverageVerdict.",
  instructions: coverageInstructions,
  model: env.COVERAGE_MODEL,
  // Least privilege: read tools only. Writes (file_claim, V2) happen in a code step after approval.
  tools: extranetReadTools,
});
