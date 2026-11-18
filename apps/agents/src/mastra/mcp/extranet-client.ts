import { MCPClient } from '@mastra/mcp';
import { env } from '../env.js';

/** MCP client used by the agents: read-only tools of the insurer extranet. */
export const extranetReadClient = new MCPClient({
  id: 'extranet-read',
  servers: {
    extranet: {
      url: new URL('/mcp', env.MCP_EXTRANET_URL),
      timeout: 20_000,
    },
  },
});

/**
 * The extranet tools under their own names (`get_policy`, not `extranet_get_policy`), so they
 * match the names used in prompts and in the server's error messages. Resolved on each agent call,
 * so the Mastra server starts even when the MCP server is not up yet.
 */
export async function extranetReadTools() {
  const toolsets = await extranetReadClient.listToolsets();
  return toolsets.extranet ?? {};
}
