import { Agent } from '@mastra/core/agent';
import { env } from '../env.js';
import { brokerCodeOf, extranetTools } from '../mcp/extranet-client.js';
import { coverageInstructions } from '../prompts/coverage.js';

export const coverageAgent = new Agent({
  id: 'coverage-agent',
  name: 'Coverage agent',
  description:
    "Checks a claim against the insurer's extranet (read-only MCP tools) and returns a sourced CoverageVerdict.",
  instructions: coverageInstructions,
  model: env.COVERAGE_MODEL,
  // Least privilege: read tools only, with a token scoped to the case's brokerage. Writes
  // (file_claim) happen in the `execute` code step, after human approval.
  tools: ({ requestContext }) => extranetTools('read', brokerCodeOf(requestContext)),
});
