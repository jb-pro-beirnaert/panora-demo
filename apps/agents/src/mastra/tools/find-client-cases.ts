import { ClientCaseSchema } from '@demo/shared';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { core } from '../core-callbacks/core-client.js';
import { CASE_ID_KEY } from '../mcp/extranet-client.js';

/**
 * The brokerage's own recent cases for a client (V15), read-only: spots a claim sent twice before
 * it is declared at the insurer, and the case a follow-up refers to.
 */
export const findClientCasesTool = createTool({
  id: 'find_client_cases',
  description:
    "Lists the brokerage's recent cases for a sender address, newest first, with their request type, status, policy, claim facts (incident date, nature, amount), claim number and last proposed action. The case being processed is left out. Use it to spot the same claim sent twice, or the case a follow-up refers to.",
  inputSchema: z.object({
    email: z.email().describe("The sender's e-mail address (From header)."),
  }),
  outputSchema: z.object({ cases: z.array(ClientCaseSchema) }),
  execute: async ({ email }, { requestContext }) => {
    const caseId = requestContext?.get(CASE_ID_KEY) as string | undefined;
    return { cases: await core.findClientCases(email, caseId) };
  },
});
