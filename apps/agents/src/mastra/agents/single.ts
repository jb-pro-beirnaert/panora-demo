import { Agent } from '@mastra/core/agent';
import { brokerCodeOf, extranetTools } from '../mcp/extranet-client.js';
import { dynamicModel } from '../models.js';
import { singleAgentInstructions } from '../prompts/single.js';
import { findClientTool } from '../tools/find-client.js';

/** V8 comparison only: one agent for triage, coverage and drafting (read tools only). */
export const singleAgent = new Agent({
  id: 'single-agent',
  name: 'Single agent',
  description: 'Triage, coverage analysis and drafting in one agent (architecture comparison).',
  instructions: singleAgentInstructions,
  // The strongest of the three roles' models.
  model: dynamicModel('coverage'),
  tools: async ({ requestContext }) => ({
    find_client: findClientTool,
    ...(await extranetTools('read', brokerCodeOf(requestContext))),
  }),
});
