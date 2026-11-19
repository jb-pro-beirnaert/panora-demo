import type { McpTokenScope } from '@demo/shared';
import { issueMcpToken } from '@demo/shared/mcp-token';
import type { RequestContext } from '@mastra/core/request-context';
import { MCPClient } from '@mastra/mcp';
import { env } from '../env.js';
import { isTransientToolError, withRetry } from '../resilience.js';

/** Request-context key carrying the brokerage of the case, set by the workflow steps. */
export const BROKER_CODE_KEY = 'brokerCode';
/** Request-context key carrying the Core case id (absent in Mastra Studio runs). */
export const CASE_ID_KEY = 'caseId';
/** Request-context key where `find_client` stores its result for the next steps. */
export const CLIENT_LOOKUP_KEY = 'clientLookup';

const clients = new Map<string, MCPClient>();

/**
 * MCP client of the insurer extranet for one brokerage and one scope. The token is bound to the
 * brokerage, so the server only exposes that brokerage's policies; `read` clients (given to the
 * agents) cannot see or call `file_claim`, only the `write` client of the `execute` step can.
 */
export function extranetClient(scope: McpTokenScope, brokerCode: string): MCPClient {
  const key = `${scope}:${brokerCode}`;
  let client = clients.get(key);
  if (!client) {
    const token = issueMcpToken({ scope, brokerCode }, env.MCP_TOKEN_SECRET);
    client = new MCPClient({
      id: `extranet-${scope}-${brokerCode}`,
      servers: {
        extranet: {
          url: new URL('/mcp', env.MCP_EXTRANET_URL),
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
          // Explicit timeout of every MCP request (a slow extranet ends in a retry, not a hang).
          timeout: env.MCP_TIMEOUT_MS,
        },
      },
    });
    clients.set(key, client);
  }
  return client;
}

/**
 * The extranet tools under their own names (`get_policy`, not `extranet_get_policy`), so they
 * match the names used in prompts and in the server's error messages. Resolved on each call, so
 * the Mastra server starts even when the MCP server is not up yet.
 */
export async function extranetTools(scope: McpTokenScope, brokerCode: string) {
  const toolsets = await withRetry(
    'extranet listToolsets',
    () => extranetClient(scope, brokerCode).listToolsets(),
    { attempts: 4, baseDelayMs: 300 },
  );
  const tools = toolsets.extranet ?? {};
  // Every tool call is retried on transient errors (flaky extranet, rate limit): thrown errors
  // and error results that look like transport failures alike.
  for (const [name, tool] of Object.entries(tools)) {
    const execute = tool.execute?.bind(tool);
    if (!execute) continue;
    tool.execute = (async (...args: Parameters<typeof execute>) =>
      withRetry(
        `extranet ${name}`,
        async () => {
          const result = await execute(...args);
          if (isTransientToolError(result)) throw new Error(JSON.stringify(result).slice(0, 300));
          return result;
        },
        { attempts: env.MCP_RETRY_ATTEMPTS, baseDelayMs: 400 },
      )) as typeof tool.execute;
  }
  return tools;
}

export function brokerCodeOf(requestContext: RequestContext): string {
  const brokerCode = requestContext.get(BROKER_CODE_KEY);
  if (typeof brokerCode !== 'string' || brokerCode.length === 0) {
    throw new Error(
      `"${BROKER_CODE_KEY}" is missing from the request context: run the agent through the process-email workflow.`,
    );
  }
  return brokerCode;
}
