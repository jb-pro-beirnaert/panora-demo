import { ClientLookupResultSchema, type ClientLookupResult } from '@demo/shared';
import type { RequestContext } from '@mastra/core/request-context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { core } from '../core-callbacks/core-client.js';
import { brokerCodeOf, CASE_ID_KEY, CLIENT_LOOKUP_KEY } from '../mcp/extranet-client.js';

/**
 * Looks `email` up in Core, reports the step and keeps the result in the request context.
 * Shared by the tool and by the triage step's fallback (when the model skipped the tool).
 */
export async function lookupClient(
  requestContext: RequestContext,
  email: string,
): Promise<ClientLookupResult | null> {
  const result = await core.findClient(email, brokerCodeOf(requestContext));
  requestContext.set(CLIENT_LOOKUP_KEY, result);
  const caseId = requestContext.get(CASE_ID_KEY) as string | undefined;
  await core.step(
    caseId,
    result
      ? {
          agent: 'triage',
          stepType: 'triage.client_found',
          params: {
            email,
            clientId: result.client.id,
            companyName: result.client.companyName,
            policyCount: result.policies.length,
          },
          sources: [
            {
              kind: 'core',
              ref: 'find_client',
              link: { type: 'client', clientId: result.client.id },
            },
          ],
        }
      : {
          agent: 'triage',
          stepType: 'triage.client_not_found',
          params: { email },
          sources: [{ kind: 'core', ref: 'find_client' }],
        },
  );
  return result;
}

/**
 * Looks the sender up in the brokerage's own software (Core). Read-only. The result is also kept
 * in the request context, so the workflow passes it to the coverage agent without a second call.
 */
export const findClientTool = createTool({
  id: 'find_client',
  description:
    "Finds the brokerage's client who owns a sender e-mail address, with the policies the brokerage manages for them (number, insurer, product, status as the brokerage knows it). Call it once with the e-mail's From address. found=false means the sender is not a known client: do not guess a policy number.",
  inputSchema: z.object({
    email: z.email().describe("The sender's e-mail address (From header)."),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    client: ClientLookupResultSchema.shape.client.nullable(),
    policies: ClientLookupResultSchema.shape.policies,
  }),
  execute: async ({ email }, { requestContext }) => {
    const result = await lookupClient(requestContext!, email);
    return result
      ? { found: true, client: result.client, policies: result.policies }
      : { found: false, client: null, policies: [] };
  },
});
