import { Agent } from '@mastra/core/agent';
import { brokerCodeOf, extranetTools } from '../mcp/extranet-client.js';
import { dynamicModel } from '../models.js';
import { policyServiceInstructions } from '../prompts/policy-service.js';
import { findClientCasesTool } from '../tools/find-client-cases.js';

/** V15: cancellations and questions about a policy, checked with read-only tools. */
export const policyServiceAgent = new Agent({
  id: 'policy-service-agent',
  name: 'Policy service agent',
  description:
    "Checks a cancellation or a question about a policy against the brokerage's records and the insurer's extranet (read-only), and returns a sourced ServiceAnalysis.",
  instructions: policyServiceInstructions,
  // The strong model, like the coverage agent.
  model: dynamicModel('coverage'),
  // Least privilege: read tools only. The cancellation itself (request_cancellation) runs in the
  // `execute` code step, after the broker's approval.
  tools: async ({ requestContext }) => ({
    find_client_cases: findClientCasesTool,
    ...(await extranetTools('read', brokerCodeOf(requestContext))),
  }),
});
