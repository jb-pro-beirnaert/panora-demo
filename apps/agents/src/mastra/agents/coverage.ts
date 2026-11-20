import { Agent } from '@mastra/core/agent';
import { dynamicModel } from '../models.js';
import { brokerCodeOf, extranetTools } from '../mcp/extranet-client.js';
import { coverageInstructions } from '../prompts/coverage.js';
import { findClientCasesTool } from '../tools/find-client-cases.js';

export const coverageAgent = new Agent({
  id: 'coverage-agent',
  name: 'Coverage agent',
  description:
    "Checks a claim against the insurer's extranet (read-only MCP tools) and returns a sourced CoverageVerdict.",
  instructions: coverageInstructions,
  // Default from the env; the eval matrix can override it per request (V8).
  model: dynamicModel('coverage'),
  // Least privilege: read tools only, with a token scoped to the case's brokerage. Writes
  // (file_claim) happen in the `execute` code step, after human approval.
  // V15: plus the brokerage's own recent cases (Core, read-only), to spot a claim sent twice.
  tools: async ({ requestContext }) => ({
    find_client_cases: findClientCasesTool,
    ...(await extranetTools('read', brokerCodeOf(requestContext))),
  }),
});
